import {
  emptyActorId,
  extraActorId,
  primaryActorId,
  replyAuthorId,
  statuses
} from '@/lib/database/sql/statusTestHelpers'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Timeline } from '@/lib/services/timelines/types'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { FollowStatus } from '@/lib/types/domain/follow'
import { StatusNote, StatusPoll, StatusType } from '@/lib/types/domain/status'
import { TagType } from '@/lib/types/domain/tag'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('StatusDatabase writes', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database as Database)
    })

    describe('createNote', () => {
      it('creates a new note', async () => {
        const beforeCount = await database.getActorStatusesCount({
          actorId: extraActorId
        })
        const status = (await database.createNote({
          id: `${extraActorId}/statuses/new-post`,
          url: `${extraActorId}/statuses/new-post`,
          actorId: extraActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'This is a new post'
        })) as StatusNote
        expect(status.text).toBe('This is a new post')
        expect(
          await database.getActorStatusesCount({ actorId: extraActorId })
        ).toBe(beforeCount + 1)
      })

      it('creates a new note with attachments', async () => {
        await database.createNote({
          id: `${extraActorId}/statuses/new-post-2`,
          url: `${extraActorId}/statuses/new-post-2`,
          actorId: extraActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'This is a new post with attachments'
        })
        await database.createAttachment({
          actorId: extraActorId,
          statusId: `${extraActorId}/statuses/new-post-2`,
          mediaType: 'image/png',
          url: 'https://via.placeholder.com/150',
          width: 150,
          height: 150
        })
        await database.createAttachment({
          actorId: extraActorId,
          statusId: `${extraActorId}/statuses/new-post-2`,
          mediaType: 'image/png',
          url: 'https://via.placeholder.com/150',
          width: 150,
          height: 150
        })
        const status = (await database.getStatus({
          statusId: `${extraActorId}/statuses/new-post-2`
        })) as StatusNote
        expect(status.text).toBe('This is a new post with attachments')
        expect(status.attachments).toHaveLength(2)
      })

      it('creates a new note with tags', async () => {
        await database.createNote({
          id: `${extraActorId}/statuses/new-post-3`,
          url: `${extraActorId}/statuses/new-post-3`,
          actorId: extraActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'This is a new post with tags'
        })
        const tag = await database.createTag({
          statusId: `${extraActorId}/statuses/new-post-3`,
          type: TagType.enum.mention,
          name: '@test1',
          value: 'https://llun.test/@test1'
        })
        const status = (await database.getStatus({
          statusId: `${extraActorId}/statuses/new-post-3`
        })) as StatusNote
        expect(status.text).toBe('This is a new post with tags')
        expect(status.tags).toHaveLength(1)
        expect(status.tags).toMatchObject([
          {
            id: tag.id,
            statusId: `${extraActorId}/statuses/new-post-3`,
            type: TagType.enum.mention,
            name: '@test1',
            value: 'https://llun.test/@test1',
            createdAt: tag.createdAt,
            updatedAt: tag.updatedAt
          }
        ])
      })

      it('returns existing status without throwing unique constraint error when status id already exists', async () => {
        const statusId = `${extraActorId}/statuses/duplicate-note-test`
        const created = await database.createNote({
          id: statusId,
          url: statusId,
          actorId: extraActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'First insertion'
        })
        const duplicate = await database.createNote({
          id: statusId,
          url: statusId,
          actorId: extraActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Second insertion with same id'
        })

        expect(duplicate).toBeDefined()
        expect(duplicate.id).toBe(statusId)
        expect((duplicate as StatusNote).text).toBe('First insertion')
        expect(duplicate.publicId).toBe(created.publicId)
      })
    })

    describe('createPoll', () => {
      it.each([
        {
          description: 'persists hideTotals true when provided',
          hideTotals: true,
          expected: true
        },
        {
          description: 'defaults hideTotals to false when omitted',
          hideTotals: undefined,
          expected: false
        }
      ])('$description', async ({ hideTotals, expected }) => {
        const pollId = `${emptyActorId}/statuses/poll-hide-totals-${expected}`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Hide totals poll',
          choices: ['Yes', 'No'],
          endAt: Date.now() + 60_000,
          ...(hideTotals === undefined ? {} : { hideTotals })
        })

        const fetched = (await database.getStatus({
          statusId: pollId
        })) as StatusPoll
        expect(fetched.hideTotals).toBe(expected)
      })

      it('preserves hideTotals across a poll text update', async () => {
        const pollId = `${emptyActorId}/statuses/poll-hide-totals-preserved`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Original hidden poll',
          choices: ['Yes', 'No'],
          endAt: Date.now() + 60_000,
          hideTotals: true
        })

        await database.updatePoll({
          statusId: pollId,
          text: 'Edited hidden poll',
          choices: [
            { title: 'Yes', totalVotes: 0 },
            { title: 'No', totalVotes: 0 }
          ]
        })

        const fetched = (await database.getStatus({
          statusId: pollId
        })) as StatusPoll
        expect(fetched.hideTotals).toBe(true)
      })

      it('returns existing poll without throwing unique constraint error when status id already exists', async () => {
        const pollId = `${emptyActorId}/statuses/duplicate-poll-test`
        const created = await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'First poll insertion',
          choices: ['Option 1', 'Option 2'],
          endAt: Date.now() + 60_000
        })
        const duplicate = await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Second poll insertion with same id',
          choices: ['Option A', 'Option B'],
          endAt: Date.now() + 60_000
        })

        expect(duplicate).toBeDefined()
        expect(duplicate.id).toBe(pollId)
        expect((duplicate as StatusPoll).text).toBe('First poll insertion')
        expect(duplicate.publicId).toBe(created.publicId)
      })
    })

    describe('updateNote', () => {
      // The media ids below are realistic auto-increment `medias.id` values
      // rather than descriptive strings: `attachments.mediaId` is an `integer`
      // column on PostgreSQL (migration
      // 20260207223000_fix_attachments_media_id_type.js is PostgreSQL-only, so
      // it stays `varchar` on SQLite). A non-numeric id inserts happily under
      // SQLite's dynamic typing but fails on PostgreSQL with `invalid input
      // syntax for type integer`.
      it('updates note content and records edit history', async () => {
        const statusId = `${emptyActorId}/statuses/update-note`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Original note'
        })

        const updated = await database.updateNote({
          statusId,
          text: 'Updated note',
          summary: 'Updated summary'
        })
        expect(updated).toMatchObject({
          id: statusId,
          text: 'Updated note',
          summary: 'Updated summary'
        })

        const fetched = (await database.getStatus({
          statusId
        })) as StatusNote
        expect(fetched.edits).toHaveLength(1)
        expect(fetched.edits[0]).toMatchObject({
          text: 'Original note',
          summary: '',
          createdAt: expect.toBeNumber()
        })
      })

      it('hydrates change summaries and the time each version was superseded', async () => {
        const statusId = `${emptyActorId}/statuses/update-note-edit-summary`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: ''
        })

        await database.updateNote({
          statusId,
          text: 'Ride summary',
          summary: null
        })
        await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://example.com/ride-map.jpg',
          width: 320,
          height: 240,
          name: 'Ride route map',
          mediaId: '9100'
        })

        const fetched = (await database.getStatus({
          statusId
        })) as StatusNote

        expect(fetched.edits).toHaveLength(1)
        expect(fetched.edits[0]).toMatchObject({
          text: '',
          changes: ['text-added', 'images-added'],
          changeDetailsUnavailable: false,
          editedAt: fetched.updatedAt
        })
      })

      it('replaces note media attachments without changing note text', async () => {
        const statusId = `${emptyActorId}/statuses/update-note-media`
        const oldMediaId = '9101'
        const newMediaId = '9102'
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Original note with media'
        })
        await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://example.com/old.jpg',
          width: 320,
          height: 240,
          name: 'old.jpg',
          mediaId: oldMediaId
        })

        const updated = await database.updateNote({
          statusId,
          text: 'Original note with media',
          summary: null,
          attachments: [
            {
              type: 'upload',
              id: newMediaId,
              mediaType: 'image/png',
              url: 'https://example.com/new.png',
              width: 640,
              height: 480,
              name: 'new.png',
              // Resolved from the media row by the action layer; the database
              // method takes the snapshot already resolved.
              blurhash: null,
              focus: null,
              thumbnailUrl: null
            }
          ]
        })

        expect(updated).toMatchObject({
          id: statusId,
          text: 'Original note with media',
          attachments: [
            expect.objectContaining({
              mediaType: 'image/png',
              url: 'https://example.com/new.png',
              name: 'new.png'
            })
          ]
        })

        const attachments = await database.getAttachmentsWithMedia({
          statusId
        })
        expect(attachments).toHaveLength(1)
        expect(attachments[0]).toMatchObject({
          mediaId: newMediaId,
          url: 'https://example.com/new.png'
        })

        const fetched = (await database.getStatus({
          statusId
        })) as StatusNote
        expect(fetched.edits).toHaveLength(1)
      })

      it('preserves legacy attachments without media ids when replacing media', async () => {
        const statusId = `${emptyActorId}/statuses/update-note-preserve-legacy`
        const oldMediaId = '9201'
        const newMediaId = '9202'
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Original note with legacy media'
        })
        await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://example.com/old.jpg',
          width: 320,
          height: 240,
          name: 'old.jpg',
          mediaId: oldMediaId
        })
        const legacyAttachment = await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://remote.example/legacy.jpg',
          width: 480,
          height: 360,
          name: 'legacy.jpg'
        })

        const updated = await database.updateNote({
          statusId,
          text: 'Original note with legacy media',
          summary: null,
          attachments: [
            {
              type: 'upload',
              id: newMediaId,
              mediaType: 'image/png',
              url: 'https://example.com/new.png',
              width: 640,
              height: 480,
              name: 'new.png',
              // Resolved from the media row by the action layer; the database
              // method takes the snapshot already resolved.
              blurhash: null,
              focus: null,
              thumbnailUrl: null
            }
          ]
        })

        expect((updated as StatusNote | null)?.attachments).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: legacyAttachment.id,
              mediaId: null,
              url: 'https://remote.example/legacy.jpg',
              createdAt: legacyAttachment.createdAt
            }),
            expect.objectContaining({
              mediaId: newMediaId,
              url: 'https://example.com/new.png'
            })
          ])
        )

        const attachments = await database.getAttachments({ statusId })
        expect(attachments).toHaveLength(2)
        expect(attachments).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              mediaId: oldMediaId
            })
          ])
        )
      })

      it('clears only editable media while preserving legacy and fitness attachments', async () => {
        const statusId = `${emptyActorId}/statuses/update-note-clear-editable-media`
        const oldMediaId = '9301'
        const fitnessMediaId = '9302'
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Original note with mixed attachments'
        })
        await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://example.com/old.jpg',
          width: 320,
          height: 240,
          name: 'old.jpg',
          mediaId: oldMediaId
        })
        const legacyAttachment = await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://remote.example/legacy.jpg',
          width: 480,
          height: 360,
          name: 'legacy.jpg'
        })
        const fitnessAttachment = await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'application/gpx+xml',
          url: 'https://example.com/api/v1/fitness-files/activity',
          name: 'activity.gpx',
          mediaId: fitnessMediaId
        })

        const updated = await database.updateNote({
          statusId,
          text: 'Original note with mixed attachments',
          summary: null,
          attachments: []
        })

        expect((updated as StatusNote | null)?.attachments).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: legacyAttachment.id,
              mediaId: null
            }),
            expect.objectContaining({
              id: fitnessAttachment.id,
              mediaId: fitnessMediaId
            })
          ])
        )

        const attachments = await database.getAttachments({ statusId })
        expect(attachments).toHaveLength(2)
        expect(attachments).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              mediaId: oldMediaId
            })
          ])
        )
      })

      it('preserves existing editable attachment rows when their media id remains', async () => {
        const statusId = `${emptyActorId}/statuses/update-note-keep-existing-media`
        const existingMediaId = '9401'
        const newMediaId = '9402'
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Original note with existing media'
        })
        const existingAttachment = await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://example.com/existing.jpg',
          width: 320,
          height: 240,
          name: 'existing.jpg',
          mediaId: existingMediaId,
          createdAt: new Date('2026-04-26T10:00:00.000Z').getTime()
        })

        await database.updateNote({
          statusId,
          text: 'Original note with existing media',
          summary: null,
          attachments: [
            {
              type: 'upload',
              id: existingMediaId,
              mediaType: 'image/jpeg',
              url: 'https://example.com/existing.jpg',
              width: 320,
              height: 240,
              name: 'existing.jpg',
              // Resolved from the media row by the action layer; the database
              // method takes the snapshot already resolved.
              blurhash: null,
              focus: null,
              thumbnailUrl: null
            },
            {
              type: 'upload',
              id: newMediaId,
              mediaType: 'image/png',
              url: 'https://example.com/new.png',
              width: 640,
              height: 480,
              name: 'new.png',
              // Resolved from the media row by the action layer; the database
              // method takes the snapshot already resolved.
              blurhash: null,
              focus: null,
              thumbnailUrl: null
            }
          ]
        })

        const attachments = await database.getAttachments({ statusId })
        expect(attachments).toHaveLength(2)
        expect(
          attachments.find(
            (attachment) => attachment.mediaId === existingMediaId
          )
        ).toMatchObject({
          id: existingAttachment.id,
          createdAt: existingAttachment.createdAt,
          updatedAt: existingAttachment.updatedAt
        })
        expect(
          attachments.find((attachment) => attachment.mediaId === newMediaId)
        ).toMatchObject({
          url: 'https://example.com/new.png'
        })
      })

      it('snapshots sensitive, attachments and poll options into edit history revisions', async () => {
        const statusId = `${emptyActorId}/statuses/update-note-history-snapshot`
        const snapshotOldMediaId = '9501'
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Snapshot original',
          sensitive: true
        })
        await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://example.com/snapshot-old.jpg',
          width: 320,
          height: 240,
          name: 'old alt text',
          mediaId: snapshotOldMediaId
        })

        await database.updateNote({
          statusId,
          text: 'Snapshot updated',
          summary: null,
          sensitive: false,
          attachments: []
        })

        const revisions = await database.getStatusEditHistory({ statusId })
        expect(revisions).toHaveLength(1)
        expect(revisions[0]).toMatchObject({
          text: 'Snapshot original',
          sensitive: true,
          pollOptions: null,
          available: {
            text: true,
            summary: true,
            sensitive: true,
            attachments: true,
            pollOptions: true
          }
        })
        expect(revisions[0].attachments).toHaveLength(1)
        expect(revisions[0].attachments?.[0]).toMatchObject({
          url: 'https://example.com/snapshot-old.jpg',
          name: 'old alt text',
          mediaId: snapshotOldMediaId
        })
      })

      it('refreshes the copied name on attachments kept across an edit', async () => {
        const statusId = `${emptyActorId}/statuses/update-note-refresh-name`
        const keptMediaId = '9601'
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Refresh name target'
        })
        await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://example.com/kept.jpg',
          width: 320,
          height: 240,
          name: 'old alt',
          mediaId: keptMediaId
        })

        const updated = await database.updateNote({
          statusId,
          text: 'Refresh name target',
          summary: null,
          attachments: [
            {
              type: 'upload',
              id: keptMediaId,
              mediaType: 'image/jpeg',
              url: 'https://example.com/kept.jpg',
              width: 320,
              height: 240,
              name: 'new alt',
              // Resolved from the media row by the action layer; the database
              // method takes the snapshot already resolved.
              blurhash: null,
              focus: null,
              thumbnailUrl: null
            }
          ]
        })

        expect((updated as StatusNote | null)?.attachments).toEqual([
          expect.objectContaining({ mediaId: keptMediaId, name: 'new alt' })
        ])
      })

      it('points a kept attachment at the edited file of its media', async () => {
        const statusId = `${emptyActorId}/statuses/update-note-refresh-file`
        const keptMediaId = '9701'
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Refresh file target'
        })
        const existing = await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://example.com/api/v1/files/medias/upload.jpg',
          width: 4000,
          height: 3000,
          name: 'alt',
          mediaId: keptMediaId,
          createdAt: new Date('2026-04-26T10:00:00.000Z').getTime()
        })

        await database.updateNote({
          statusId,
          text: 'Refresh file target',
          summary: null,
          attachments: [
            {
              type: 'upload',
              id: keptMediaId,
              mediaType: 'image/webp',
              url: 'https://example.com/api/v1/files/medias/render.webp',
              width: 2000,
              height: 1500,
              name: 'alt',
              blurhash: null,
              focus: null,
              thumbnailUrl: null
            }
          ]
        })

        const attachments = await database.getAttachments({ statusId })
        expect(attachments).toHaveLength(1)
        expect(attachments[0]).toMatchObject({
          id: existing.id,
          mediaId: keptMediaId,
          mediaType: 'image/webp',
          url: 'https://example.com/api/v1/files/medias/render.webp',
          width: 2000,
          height: 1500,
          name: 'alt'
        })
        expect(attachments[0].updatedAt).toBeGreaterThan(existing.updatedAt)
      })
    })

    describe('updateNoteVisibility', () => {
      it('updates recipients when visibility changes', async () => {
        const statusId = `${emptyActorId}/statuses/update-note-visibility`
        const note = await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Original note for visibility test'
        })

        await addStatusToTimelines(database, note)

        const timelineBefore = await database.getTimeline({
          timeline: Timeline.MAIN,
          actorId: emptyActorId
        })
        expect(timelineBefore.some((s) => s.id === statusId)).toBeTrue()

        const followersUrl = `${emptyActorId}/followers`
        const updated = await database.updateNoteVisibility({
          statusId,
          to: [followersUrl],
          cc: []
        })

        expect(updated).not.toBeNull()
        expect(updated?.to).toEqual([followersUrl])
        expect(updated?.cc).toEqual([])

        const fetched = (await database.getStatus({ statusId })) as StatusNote
        expect(fetched.to).toEqual([followersUrl])
        expect(fetched.cc).toEqual([])
        expect(fetched.edits).toHaveLength(0)

        const timelineAfter = await database.getTimeline({
          timeline: Timeline.MAIN,
          actorId: emptyActorId
        })
        expect(timelineAfter.some((s) => s.id === statusId)).toBeFalse()
      })

      it('drops edit history when the audience widens', async () => {
        const statusId = `${emptyActorId}/statuses/visibility-widen-history`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [`${emptyActorId}/followers`],
          cc: [],
          text: 'followers-only secret'
        })
        await database.updateNote({ statusId, text: 'redacted' })
        expect(await database.getStatusEditHistory({ statusId })).toHaveLength(
          1
        )

        await database.updateNoteVisibility({
          statusId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${emptyActorId}/followers`]
        })

        expect(await database.getStatusEditHistory({ statusId })).toEqual([])
        const fetched = (await database.getStatus({ statusId })) as StatusNote
        expect(fetched.text).toBe('redacted')
        expect(fetched.edits).toEqual([])
      })

      it('keeps edit history when the audience narrows', async () => {
        const statusId = `${emptyActorId}/statuses/visibility-narrow-history`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${emptyActorId}/followers`],
          text: 'public original'
        })
        await database.updateNote({ statusId, text: 'public edit' })

        await database.updateNoteVisibility({
          statusId,
          to: [`${emptyActorId}/followers`],
          cc: []
        })

        const history = await database.getStatusEditHistory({ statusId })
        expect(history.map((revision) => revision.text)).toEqual([
          'public original'
        ])
      })

      it('returns null for nonexistent statusId', async () => {
        const result = await database.updateNoteVisibility({
          statusId: 'https://nonexistent.example/statuses/does-not-exist',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        expect(result).toBeNull()
      })

      it('returns null for non-Note status type (Poll)', async () => {
        const result = await database.updateNoteVisibility({
          statusId: statuses.poll.status,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        expect(result).toBeNull()
      })

      it('returns null for non-Note status type (Announce)', async () => {
        const result = await database.updateNoteVisibility({
          statusId: statuses.replyAuthor.announceOwn,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        expect(result).toBeNull()
      })
    })

    describe('updatePoll', () => {
      it('updates poll content and choice totals', async () => {
        const pollId = `${emptyActorId}/statuses/poll-update`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Original poll',
          summary: 'Original summary',
          choices: ['Alpha', 'Beta'],
          endAt: Date.now() + 1000
        })

        const updated = await database.updatePoll({
          statusId: pollId,
          text: 'Updated poll',
          summary: 'Updated summary',
          choices: [
            { title: 'Alpha', totalVotes: 2 },
            { title: 'Beta', totalVotes: 1 }
          ]
        })

        expect(updated).toMatchObject({
          id: pollId,
          text: 'Updated poll',
          summary: 'Updated summary'
        })

        const fetched = (await database.getStatus({
          statusId: pollId
        })) as StatusPoll
        expect(fetched.edits).toHaveLength(1)
        expect(fetched.choices).toMatchObject([
          { title: 'Alpha', totalVotes: 2 },
          { title: 'Beta', totalVotes: 1 }
        ])
      })

      it('normalizes an empty summary to null without a spurious edit revision', async () => {
        const pollId = `${emptyActorId}/statuses/poll-empty-summary`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'No CW poll',
          summary: null,
          choices: ['Alpha', 'Beta'],
          endAt: Date.now() + 1000
        })

        // Editing a null-CW poll with the conventional empty spoiler keeps the
        // summary null (not ''), matching createPoll's `|| null` normalization,
        // so nothing user-visible changes and no edit revision is recorded.
        await database.updatePoll({
          statusId: pollId,
          text: 'No CW poll',
          summary: '',
          choices: [
            { title: 'Alpha', totalVotes: 0 },
            { title: 'Beta', totalVotes: 0 }
          ]
        })

        const fetched = (await database.getStatus({
          statusId: pollId
        })) as StatusPoll
        expect(fetched.summary ?? null).toBeNull()
        expect(fetched.edits).toHaveLength(0)
      })

      it('records no spurious revision when a createPoll-default ("") summary is cleared', async () => {
        const pollId = `${emptyActorId}/statuses/poll-default-summary`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Default summary poll',
          // No summary -> createPoll default '' (the action would pass null);
          // clearing it must still be treated as unchanged vs null.
          choices: ['Alpha', 'Beta'],
          endAt: Date.now() + 1000
        })

        await database.updatePoll({
          statusId: pollId,
          text: 'Default summary poll',
          summary: '',
          choices: [
            { title: 'Alpha', totalVotes: 0 },
            { title: 'Beta', totalVotes: 0 }
          ]
        })

        const fetched = (await database.getStatus({
          statusId: pollId
        })) as StatusPoll
        expect(fetched.edits).toHaveLength(0)
      })

      it('snapshots previous poll options into edit history when poll content changes', async () => {
        const pollId = `${emptyActorId}/statuses/poll-history-snapshot`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Original poll text',
          choices: ['Old A', 'Old B'],
          endAt: Date.now() + 60_000
        })

        await database.updatePoll({
          statusId: pollId,
          text: 'Updated poll text',
          choices: [
            { title: 'Old A', totalVotes: 0 },
            { title: 'Old B', totalVotes: 0 }
          ]
        })

        const revisions = await database.getStatusEditHistory({
          statusId: pollId
        })
        expect(revisions).toHaveLength(1)
        expect(revisions[0]).toMatchObject({
          text: 'Original poll text',
          sensitive: false,
          attachments: [],
          pollOptions: ['Old A', 'Old B']
        })
      })

      it('replaces poll options and resets votes when resetVotes is true', async () => {
        const pollId = `${emptyActorId}/statuses/poll-replace-options`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Replace options poll',
          choices: ['Old A', 'Old B'],
          endAt: Date.now() + 60_000
        })
        await database.recordPollVotes({
          statusId: pollId,
          actorId: primaryActorId,
          choices: [0]
        })

        const updated = (await database.updatePoll({
          statusId: pollId,
          text: 'Replace options poll',
          choices: [
            { title: 'New A', totalVotes: 0 },
            { title: 'New B', totalVotes: 0 },
            { title: 'New C', totalVotes: 0 }
          ],
          endAt: Date.now() + 120_000,
          hideTotals: true,
          resetVotes: true
        })) as StatusPoll

        expect(updated.choices.map((choice) => choice.title)).toEqual([
          'New A',
          'New B',
          'New C'
        ])
        expect(updated.choices.every((choice) => choice.totalVotes === 0)).toBe(
          true
        )
        expect(updated.votersCount).toBe(0)
        expect(updated.hideTotals).toBe(true)

        const revisions = await database.getStatusEditHistory({
          statusId: pollId
        })
        expect(revisions).toHaveLength(1)
        expect(revisions[0].pollOptions).toEqual(['Old A', 'Old B'])
      })

      it('does not record an edit revision for a tally-only update', async () => {
        const pollId = `${emptyActorId}/statuses/poll-tally-only`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Tally poll',
          choices: ['Yes', 'No'],
          endAt: Date.now() + 60_000
        })

        await database.updatePoll({
          statusId: pollId,
          text: 'Tally poll',
          choices: [
            { title: 'Yes', totalVotes: 5 },
            { title: 'No', totalVotes: 2 }
          ]
        })

        await expect(
          database.getStatusEditHistory({ statusId: pollId })
        ).resolves.toEqual([])
      })
    })

    describe('poll votes', () => {
      it('records votes and increments choice totals', async () => {
        const pollId = `${emptyActorId}/statuses/poll-votes`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Vote poll',
          choices: ['Yes', 'No'],
          endAt: Date.now() + 1000
        })

        const voterId = replyAuthorId
        expect(
          await database.hasActorVoted({ statusId: pollId, actorId: voterId })
        ).toBeFalse()

        await database.createPollAnswer({
          statusId: pollId,
          actorId: voterId,
          choice: 0
        })
        await database.incrementPollChoiceVotes({
          statusId: pollId,
          choiceIndex: 0
        })

        expect(
          await database.hasActorVoted({ statusId: pollId, actorId: voterId })
        ).toBeTrue()
        expect(
          await database.getActorPollVotes({
            statusId: pollId,
            actorId: voterId
          })
        ).toEqual([0])

        const poll = (await database.getStatus({
          statusId: pollId,
          currentActorId: voterId
        })) as StatusPoll
        expect(poll.choices[0]).toMatchObject({ totalVotes: 1 })
        expect(poll).toMatchObject({
          voted: true,
          ownVotes: [0]
        })
      })

      it('returns actor poll votes for multiple statuses', async () => {
        const firstPollId = `${emptyActorId}/statuses/poll-votes-bulk-1`
        const secondPollId = `${emptyActorId}/statuses/poll-votes-bulk-2`
        const thirdPollId = `${emptyActorId}/statuses/poll-votes-bulk-3`
        const voterId = `${replyAuthorId}/poll-votes-bulk`

        for (const pollId of [firstPollId, secondPollId, thirdPollId]) {
          await database.createPoll({
            id: pollId,
            url: pollId,
            actorId: emptyActorId,
            to: ['https://www.w3.org/ns/activitystreams#Public'],
            cc: [],
            text: 'Vote poll',
            choices: ['Yes', 'No'],
            pollType: 'anyOf',
            endAt: Date.now() + 1000
          })
        }

        await database.recordPollVotes({
          statusId: firstPollId,
          actorId: voterId,
          choices: [1, 0]
        })
        await database.recordPollVotes({
          statusId: secondPollId,
          actorId: voterId,
          choices: [1]
        })

        await expect(
          database.getActorPollVotesForStatuses({
            statusIds: [firstPollId, secondPollId, thirdPollId, firstPollId],
            actorId: voterId
          })
        ).resolves.toEqual({
          [firstPollId]: [0, 1],
          [secondPollId]: [1],
          [thirdPollId]: []
        })
      })

      it('records a Mastodon poll vote atomically and rejects duplicate voters', async () => {
        const pollId = `${emptyActorId}/statuses/record-poll-votes`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Vote poll',
          choices: ['Yes', 'No'],
          pollType: 'anyOf',
          endAt: Date.now() + 1000
        })

        const voterId = `${replyAuthorId}/record-poll-votes`
        await expect(
          database.recordPollVotes({
            statusId: pollId,
            actorId: voterId,
            choices: [0, 0, 1]
          })
        ).resolves.toBeTrue()
        await expect(
          database.recordPollVotes({
            statusId: pollId,
            actorId: voterId,
            choices: [1]
          })
        ).resolves.toBeFalse()

        expect(
          await database.getActorPollVotes({
            statusId: pollId,
            actorId: voterId
          })
        ).toEqual([0, 1])

        const poll = (await database.getStatus({
          statusId: pollId,
          currentActorId: voterId
        })) as StatusPoll
        expect(poll.choices).toMatchObject([
          { totalVotes: 1 },
          { totalVotes: 1 }
        ])
      })

      it('appends distinct federated anyOf choices without recounting duplicate choices', async () => {
        const pollId = `${emptyActorId}/statuses/record-poll-vote-append`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Vote poll',
          choices: ['Yes', 'No'],
          pollType: 'anyOf',
          endAt: Date.now() + 1000
        })

        const voterId = `${replyAuthorId}/record-poll-vote-append`
        await expect(
          database.recordPollVotes({
            statusId: pollId,
            actorId: voterId,
            choices: [0],
            allowAdditionalChoices: true
          })
        ).resolves.toBeTrue()
        await expect(
          database.recordPollVotes({
            statusId: pollId,
            actorId: voterId,
            choices: [1],
            allowAdditionalChoices: true
          })
        ).resolves.toBeTrue()
        await expect(
          database.recordPollVotes({
            statusId: pollId,
            actorId: voterId,
            choices: [0],
            allowAdditionalChoices: true
          })
        ).resolves.toBeFalse()

        const poll = (await database.getStatus({
          statusId: pollId,
          currentActorId: voterId
        })) as StatusPoll
        expect(poll.choices).toMatchObject([
          { totalVotes: 1 },
          { totalVotes: 1 }
        ])
        expect(poll.ownVotes).toEqual([0, 1])
      })
    })

    describe('createAnnounce', () => {
      const TEST_ID_ORIGINAL = `https://${TEST_DOMAIN}/users/announce-original`
      const TEST_ID_BOOSTER = `https://${TEST_DOMAIN}/users/announce-booster`
      const TEST_ID_FOLLOWER = `https://${TEST_DOMAIN}/users/announce-follower`

      beforeAll(async () => {
        await database.createAccount({
          email: `announce-original@${TEST_DOMAIN}`,
          username: 'announce-original',
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: 'privateKey-announce-original',
          publicKey: 'publicKey-announce-original'
        })
        await database.createAccount({
          email: `announce-booster@${TEST_DOMAIN}`,
          username: 'announce-booster',
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: 'privateKey-announce-booster',
          publicKey: 'publicKey-announce-booster'
        })
        await database.createAccount({
          email: `announce-follower@${TEST_DOMAIN}`,
          username: 'announce-follower',
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: 'privateKey-announce-follower',
          publicKey: 'publicKey-announce-follower'
        })
      })

      it('returns status with actorAnnounceStatusId in timeline', async () => {
        await database.createFollow({
          actorId: TEST_ID_BOOSTER,
          targetActorId: TEST_ID_ORIGINAL,
          status: FollowStatus.enum.Accepted,
          inbox: `${TEST_ID_BOOSTER}/inbox`,
          sharedInbox: `${TEST_ID_BOOSTER}/inbox`
        })
        await database.createFollow({
          actorId: TEST_ID_FOLLOWER,
          targetActorId: TEST_ID_BOOSTER,
          status: FollowStatus.enum.Accepted,
          inbox: `${TEST_ID_FOLLOWER}/inbox`,
          sharedInbox: `${TEST_ID_FOLLOWER}/inbox`
        })

        const originalPostId = `${TEST_ID_ORIGINAL}/posts/boost-original`
        const note = await database.createNote({
          id: originalPostId,
          url: originalPostId,
          actorId: TEST_ID_ORIGINAL,
          text: 'This is status for boost',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${TEST_ID_ORIGINAL}/followers`]
        })
        await addStatusToTimelines(database, note)

        const announcePostId = `${TEST_ID_BOOSTER}/posts/boost-announce`
        const announce = await database.createAnnounce({
          id: announcePostId,
          actorId: TEST_ID_BOOSTER,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${TEST_ID_BOOSTER}/followers`],
          originalStatusId: originalPostId
        })
        if (!announce) {
          fail('Announce must not be undefined')
        }
        await addStatusToTimelines(database, announce)

        const boosterTimeline = await database.getTimeline({
          timeline: Timeline.MAIN,
          actorId: TEST_ID_BOOSTER
        })
        const statusData = boosterTimeline.shift() as StatusNote
        expect(statusData.actorAnnounceStatusId).not.toBeNull()

        const followerTimeline = await database.getTimeline({
          timeline: Timeline.MAIN,
          actorId: TEST_ID_FOLLOWER
        })
        const announceStatus = followerTimeline.shift()
        if (announceStatus?.type !== StatusType.enum.Announce) {
          fail('Status must be announce')
        }

        const originalStatus = announceStatus.originalStatus
        expect(originalStatus.id).toEqual(note.id)
      })

      it('returns existing announce without throwing unique constraint error when status id already exists', async () => {
        const originalStatusId = `${TEST_ID_ORIGINAL}/statuses/duplicate-announce-target`
        await database.createNote({
          id: originalStatusId,
          url: originalStatusId,
          actorId: TEST_ID_ORIGINAL,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Post to announce'
        })
        const announceId = `${TEST_ID_BOOSTER}/statuses/duplicate-announce-test`
        const created = await database.createAnnounce({
          id: announceId,
          actorId: TEST_ID_BOOSTER,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId
        })
        const duplicate = await database.createAnnounce({
          id: announceId,
          actorId: TEST_ID_BOOSTER,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId
        })

        expect(duplicate).toBeDefined()
        expect(duplicate?.id).toBe(announceId)
        expect(duplicate?.publicId).toBe(created?.publicId)
      })

      it('returns null when original status does not exist', async () => {
        const announcePostId = `${TEST_ID_BOOSTER}/posts/boost-missing-original`
        const announce = await database.createAnnounce({
          id: announcePostId,
          actorId: TEST_ID_BOOSTER,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${TEST_ID_BOOSTER}/followers`],
          originalStatusId: 'https://somewhere.test/posts/non-existent-status'
        })
        expect(announce).toBeNull()
      })
    })
  })
})
