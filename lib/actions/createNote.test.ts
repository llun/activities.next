import { createNoteFromUserInput } from '@/lib/actions/createNote'
import {
  FETCH_LINK_PREVIEW_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { MAX_FEDERATION_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
import { getQueue } from '@/lib/services/queue'
import { updateServerSettings } from '@/lib/services/serverSettings'
import * as timelinesService from '@/lib/services/timelines'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { Document, Note } from '@/lib/types/activitypub'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { isPublicId } from '@/lib/utils/publicId'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'

import { useCreateNoteFixtures } from './createNote.testUtils'

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: vi.fn()
}))

describe('Create note action', () => {
  const {
    database,
    actors,
    mockSendNotificationAlerts,
    clearSettledNotificationAlerts
  } = useCreateNoteFixtures()
  let actor1: Actor
  let actor2: Actor

  beforeAll(() => {
    actor1 = actors.actor1
    actor2 = actors.actor2
  })

  describe('createNoteFromUserInput', () => {
    it('adds status to database and returns note', async () => {
      const status = (await createNoteFromUserInput({
        text: 'Hello',
        currentActor: actor1,
        database
      })) as StatusNote

      expect(status).toMatchObject({
        actorId: actor1.id,
        text: 'Hello',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`]
      })
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(status.id),
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: status.id
        }
      })

      expect(timelinesService.addStatusToTimelines).toHaveBeenCalledWith(
        database,
        status
      )
    })

    it('counts a hashtag only on a publicly addressed note', async () => {
      // The counter is served to anonymous /tags/<tag> visitors, so a
      // followers-only or direct post's tag must not be observable through it.
      for (const visibility of ['private', 'direct', 'unlisted'] as const) {
        await createNoteFromUserInput({
          text: `Hello #actionaudiencecount ${visibility}`,
          currentActor: actor1,
          database,
          visibility
        })
      }

      expect(
        await database.getHashtagCounter({ hashtag: 'actionaudiencecount' })
      ).toBe(1)
    })

    it('mints the new status URI tail from a v7 publicId', async () => {
      const status = (await createNoteFromUserInput({
        text: 'New status URI tail',
        currentActor: actor1,
        database
      })) as StatusNote

      expect(status.publicId).toBeTruthy()
      expect(isPublicId(status.publicId as string)).toBe(true)
      expect(status.id).toBe(`${actor1.id}/statuses/${status.publicId}`)
    })

    it('forces sensitive to true when the creating actor is sensitized', async () => {
      const sensitizedActor = { ...actor1, sensitizedAt: Date.now() }
      const status = (await createNoteFromUserInput({
        text: 'Hello',
        sensitive: false,
        currentActor: sensitizedActor,
        database
      })) as StatusNote

      expect(status.sensitive).toBe(true)
    })

    it('records an accepted edge and notifies the quoted author for a local quote', async () => {
      const quoted = (await createNoteFromUserInput({
        text: 'quoted',
        currentActor: actor1,
        database
      })) as StatusNote
      mockSendNotificationAlerts.mockClear()

      const quoting = (await createNoteFromUserInput({
        text: 'quoting',
        currentActor: actor2,
        quotedStatusId: quoted.id,
        database
      })) as StatusNote

      const edge = await database.getStatusQuote({ statusId: quoting.id })
      expect(edge).toMatchObject({
        quotedStatusId: quoted.id,
        state: 'accepted'
      })

      const hydrated = (await database.getStatus({
        statusId: quoting.id
      })) as StatusNote
      expect(hydrated.quote?.state).toBe('accepted')

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(mockSendNotificationAlerts).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: actor1.id,
          events: expect.arrayContaining([
            expect.objectContaining({ type: 'quote' })
          ])
        })
      )
    })

    it('persists the quote_approval_policy on the status', async () => {
      const status = (await createNoteFromUserInput({
        text: 'restricted',
        currentActor: actor1,
        quoteApprovalPolicy: 'followers',
        database
      })) as StatusNote

      expect(status.quoteApprovalPolicy).toBe('followers')
    })

    it('stores a content-detected language that overrides a mislabeled declared language', async () => {
      const status = (await createNoteFromUserInput({
        text: 'สวัสดีครับ ผมชื่อจอห์น ผมเป็นนักพัฒนาซอฟต์แวร์ที่ทำงานในกรุงเทพมหานคร',
        currentActor: actor1,
        language: 'en',
        database
      })) as StatusNote

      expect(status.language).toBe('en')
      expect(status.detectedLanguage).toBe('th')
    })

    it('leaves the detected language unset for short text', async () => {
      const status = (await createNoteFromUserInput({
        text: 'Hello',
        currentActor: actor1,
        database
      })) as StatusNote

      expect(status.detectedLanguage).toBeNull()
    })

    it('stores content warning text as note summary', async () => {
      const status = (await createNoteFromUserInput({
        text: 'Hidden behind a warning',
        summary: 'Movie spoilers',
        currentActor: actor1,
        database
      })) as StatusNote

      expect(status.summary).toBe('Movie spoilers')

      const note = getNoteFromStatus(status) as Note
      expect(note.summary).toBe('Movie spoilers')
    })

    it('batches hashtag search reindexing after hashtag tags are created', async () => {
      const indexHashtagSearchDocuments = vi.spyOn(
        database,
        'indexHashtagSearchDocuments'
      )

      try {
        await createNoteFromUserInput({
          text: 'Batch this #BatchOne and #BatchTwo',
          currentActor: actor1,
          database
        })

        expect(indexHashtagSearchDocuments).toHaveBeenCalledTimes(1)
        expect(indexHashtagSearchDocuments).toHaveBeenCalledWith({
          hashtags: ['#BatchOne', '#BatchTwo']
        })
      } finally {
        indexHashtagSearchDocuments.mockRestore()
      }
    })

    it('set reply to replyStatus id', async () => {
      const status = (await createNoteFromUserInput({
        text: 'Hello',
        currentActor: actor1,
        replyNoteId: `${actor2?.id}/statuses/post-2`,
        database
      })) as StatusNote

      expect(status).toMatchObject({
        reply: `${actor2?.id}/statuses/post-2`,
        cc: expect.arrayContaining([actor2?.id])
      })
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(status.id),
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: status.id
        }
      })
    })

    it('omits ActivityPub updated timestamp for newly created replies', async () => {
      const status = (await createNoteFromUserInput({
        text: '@test2@llun.test Hello from a new reply',
        currentActor: actor1,
        replyNoteId: `${actor2?.id}/statuses/post-2`,
        database
      })) as StatusNote

      const note = getNoteFromStatus(status) as Note

      expect(note.inReplyTo).toBe(`${actor2?.id}/statuses/post-2`)
      expect(note.content).toContain('class="u-url mention"')
      expect(note).not.toHaveProperty('updated')
    })

    it('allows ActivityPub updated timestamp to be explicitly omitted', async () => {
      const status = (await createNoteFromUserInput({
        text: 'Original note for explicit updated option',
        currentActor: actor1,
        database
      })) as StatusNote
      const updatedStatus = (await database.updateNote({
        statusId: status.id,
        text: 'Edited note for explicit updated option',
        summary: null
      })) as StatusNote

      const note = getNoteFromStatus(updatedStatus, {
        includeUpdated: false
      }) as Note

      expect(updatedStatus.edits).toHaveLength(1)
      expect(note).not.toHaveProperty('updated')
    })

    it('does not create reply notification or alert when reply target blocks source', async () => {
      await clearSettledNotificationAlerts()
      const originalStatus = (await createNoteFromUserInput({
        text: 'Original post from actor2',
        currentActor: actor2,
        database
      })) as StatusNote

      await database.createBlock({
        actorId: actor2.id,
        targetActorId: actor1.id,
        uri: `${actor2.id}#blocks/create-note-reply-block`
      })

      try {
        const replyStatus = (await createNoteFromUserInput({
          text: 'Blocked reply',
          currentActor: actor1,
          replyNoteId: originalStatus.id,
          database
        })) as StatusNote
        await new Promise((resolve) => setTimeout(resolve, 0))

        const notifications = await database.getNotifications({
          actorId: actor2.id,
          limit: 100
        })
        expect(
          notifications.filter(
            (notification) => notification.statusId === replyStatus.id
          )
        ).toHaveLength(0)
        expect(mockSendNotificationAlerts).not.toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: actor2.id,
            sourceActorId: actor1.id,
            statusId: replyStatus.id
          })
        )
      } finally {
        await database.deleteBlock({
          actorId: actor2.id,
          targetActorId: actor1.id
        })
      }
    })

    it('does not create mention notification or alert when mentioned actor blocks source', async () => {
      await clearSettledNotificationAlerts()
      await database.createBlock({
        actorId: actor2.id,
        targetActorId: actor1.id,
        uri: `${actor2.id}#blocks/create-note-mention-block`
      })

      try {
        const status = (await createNoteFromUserInput({
          text: '@test2@llun.test blocked mention',
          currentActor: actor1,
          database
        })) as StatusNote
        await new Promise((resolve) => setTimeout(resolve, 0))

        const notifications = await database.getNotifications({
          actorId: actor2.id,
          limit: 100
        })
        expect(
          notifications.filter(
            (notification) => notification.statusId === status.id
          )
        ).toHaveLength(0)
        expect(mockSendNotificationAlerts).not.toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: actor2.id,
            sourceActorId: actor1.id,
            statusId: status.id
          })
        )
      } finally {
        await database.deleteBlock({
          actorId: actor2.id,
          targetActorId: actor1.id
        })
      }
    })

    it('does not create mention notification or alert when mentioned actor mutes source with notifications=true', async () => {
      await clearSettledNotificationAlerts()
      await database.createMute({
        actorId: actor2.id,
        targetActorId: actor1.id,
        notifications: true,
        endsAt: null
      })

      try {
        const status = (await createNoteFromUserInput({
          text: '@test2@llun.test muted mention with notifications',
          currentActor: actor1,
          database
        })) as StatusNote
        await new Promise((resolve) => setTimeout(resolve, 0))

        const notifications = await database.getNotifications({
          actorId: actor2.id,
          limit: 100
        })
        expect(
          notifications.filter(
            (notification) => notification.statusId === status.id
          )
        ).toHaveLength(0)
        expect(mockSendNotificationAlerts).not.toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: actor2.id,
            sourceActorId: actor1.id,
            statusId: status.id
          })
        )
      } finally {
        await database.deleteMute({
          actorId: actor2.id,
          targetActorId: actor1.id
        })
      }
    })

    it('creates mention notification when mute has notifications=false', async () => {
      await clearSettledNotificationAlerts()
      await database.createMute({
        actorId: actor2.id,
        targetActorId: actor1.id,
        notifications: false,
        endsAt: null
      })

      try {
        const status = (await createNoteFromUserInput({
          text: '@test2@llun.test muted mention without notifications',
          currentActor: actor1,
          database
        })) as StatusNote
        await new Promise((resolve) => setTimeout(resolve, 0))

        const notifications = await database.getNotifications({
          actorId: actor2.id,
          limit: 100
        })
        expect(
          notifications.filter(
            (notification) => notification.statusId === status.id
          )
        ).toHaveLength(1)
        expect(mockSendNotificationAlerts).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: actor2.id,
            sourceActorId: actor1.id,
            statusId: status.id
          })
        )
      } finally {
        await database.deleteMute({
          actorId: actor2.id,
          targetActorId: actor1.id
        })
      }
    })

    it('merges into a single reply notification when a reply also mentions the parent author', async () => {
      await clearSettledNotificationAlerts()
      const originalStatus = (await createNoteFromUserInput({
        text: 'Original post from actor2 for reply+mention merge',
        currentActor: actor2,
        database
      })) as StatusNote

      const replyStatus = (await createNoteFromUserInput({
        text: '@test2@llun.test thanks for the post!',
        currentActor: actor1,
        replyNoteId: originalStatus.id,
        database
      })) as StatusNote
      await new Promise((resolve) => setTimeout(resolve, 0))

      const notifications = await database.getNotifications({
        actorId: actor2.id,
        limit: 100
      })
      const replyMentionNotifications = notifications.filter(
        (notification) => notification.statusId === replyStatus.id
      )
      // Only the reply notification should be kept — the duplicate mention one
      // for the same parent author is suppressed.
      expect(replyMentionNotifications).toHaveLength(1)
      expect(replyMentionNotifications[0].type).toBe(
        NotificationType.enum.reply
      )

      // A single reply alert is dispatched for the parent author.
      const replyAlertCalls = mockSendNotificationAlerts.mock.calls.filter(
        ([call]) =>
          call.actorId === actor2.id && call.statusId === replyStatus.id
      )
      expect(replyAlertCalls).toHaveLength(1)
      expect(replyAlertCalls[0][0].events).toEqual([
        expect.objectContaining({ type: NotificationType.enum.reply })
      ])
    })

    it('does not create reply notification when reply target mutes source with notifications=true', async () => {
      await clearSettledNotificationAlerts()
      const originalStatus = (await createNoteFromUserInput({
        text: 'Original post from actor2 for mute reply test',
        currentActor: actor2,
        database
      })) as StatusNote

      await database.createMute({
        actorId: actor2.id,
        targetActorId: actor1.id,
        notifications: true,
        endsAt: null
      })

      try {
        const replyStatus = (await createNoteFromUserInput({
          text: 'Muted reply',
          currentActor: actor1,
          replyNoteId: originalStatus.id,
          database
        })) as StatusNote
        await new Promise((resolve) => setTimeout(resolve, 0))

        const notifications = await database.getNotifications({
          actorId: actor2.id,
          limit: 100
        })
        expect(
          notifications.filter(
            (notification) => notification.statusId === replyStatus.id
          )
        ).toHaveLength(0)
        expect(mockSendNotificationAlerts).not.toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: actor2.id,
            sourceActorId: actor1.id,
            statusId: replyStatus.id
          })
        )
      } finally {
        await database.deleteMute({
          actorId: actor2.id,
          targetActorId: actor1.id
        })
      }
    })

    it('linkfy and paragraph status text', async () => {
      const text = `
@test2@llun.test Hello, test2

How are you?
`
      const status = (await createNoteFromUserInput({
        text,
        currentActor: actor1,
        database
      })) as StatusNote

      expect(status).toMatchObject({
        actorId: actor1.id,
        text,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${actor1.id}/followers`, ACTOR2_ID]
      })

      const note = getNoteFromStatus(status) as Note
      expect(note.content).toEqual(convertMarkdownText(TEST_DOMAIN)(text))
      expect(note.tag).toHaveLength(1)
      expect(note.tag).toContainEqual({
        type: 'Mention',
        href: ACTOR2_ID,
        name: '@test2@llun.test'
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(status.id),
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: status.id
        }
      })
    })

    it('cc multiple ids when replies multiple people', async () => {
      const text = `
@test2@llun.test @test3@somewhere.test Hello, people

How are you?
`
      const status = (await createNoteFromUserInput({
        text,
        currentActor: actor1,
        database
      })) as StatusNote

      expect(status).toMatchObject({
        actorId: actor1.id,
        text,
        to: [ACTIVITY_STREAM_PUBLIC]
      })
      expect(status.cc).toEqual(
        expect.arrayContaining([
          `${actor1.id}/followers`,
          'https://somewhere.test/actors/test3',
          ACTOR2_ID
        ])
      )

      const note = getNoteFromStatus(status) as Note
      expect(note.content).toEqual(convertMarkdownText(TEST_DOMAIN)(text))
      expect(note.tag).toHaveLength(2)
      expect(note.tag).toContainEqual({
        type: 'Mention',
        href: ACTOR2_ID,
        name: '@test2@llun.test'
      })
      expect(note.tag).toContainEqual({
        type: 'Mention',
        href: 'https://somewhere.test/actors/test3',
        name: '@test3@somewhere.test'
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(status.id),
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: status.id
        }
      })
    })

    it('send to everyone inboxes', async () => {
      const text = `
@test2@llun.test @test3@somewhere.test @test4@no.shared.inbox @test5@somewhere.test

Hello, people

How are you?
`
      const status = (await createNoteFromUserInput({
        text,
        currentActor: actor1,
        database
      })) as StatusNote

      expect(status).toMatchObject({
        actorId: actor1.id,
        text,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: expect.arrayContaining([
          `${actor1.id}/followers`,
          ACTOR2_ID,
          'https://somewhere.test/actors/test3',
          'https://no.shared.inbox/users/test4',
          'https://somewhere.test/actors/test5'
        ])
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(status.id),
        name: SEND_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: status.id
        }
      })
    })

    describe('subject hashtags', () => {
      const createSubjectMedia = async () => {
        const media = await database.createMedia({
          actorId: actor1.id,
          original: {
            path: `/test/subject-${Math.random()}.jpg`,
            bytes: 100,
            mimeType: 'image/jpeg',
            metaData: { width: 10, height: 10 }
          },
          details: { subjectName: 'Common Kingfisher' }
        })
        return media!.id
      }

      const postWith = async (mediaId: string) =>
        (await createNoteFromUserInput({
          text: 'Morning walk',
          currentActor: actor1,
          attachments: [
            {
              type: 'upload',
              id: mediaId,
              mediaType: 'image/jpeg',
              url: 'https://example.com/media/bird.jpg',
              width: 10,
              height: 10,
              name: 'bird.jpg'
            }
          ],
          database
        })) as StatusNote

      it.each([
        {
          description:
            'appends the subject as a hashtag when the setting is on',
          subjectHashtags: true,
          maxCharacters: 500,
          appended: true
        },
        {
          description:
            'does not append a subject hashtag past posts.maxCharacters',
          subjectHashtags: true,
          maxCharacters: 12,
          appended: false
        },
        {
          description: 'leaves the text alone when the setting is off',
          subjectHashtags: false,
          maxCharacters: 500,
          appended: false
        }
      ])(
        '$description',
        async ({ subjectHashtags, maxCharacters, appended }) => {
          await database.updateGallerySettings({
            actorId: actor1.id,
            subjectHashtags
          })
          await updateServerSettings(database, {
            'posts.maxCharacters': maxCharacters
          })
          try {
            const status = await postWith(await createSubjectMedia())
            if (appended) {
              expect(status.text).toContain('#CommonKingfisher')
            } else {
              expect(status.text).toBe('Morning walk')
            }
          } finally {
            await updateServerSettings(database, { 'posts.maxCharacters': 500 })
          }
        }
      )
    })

    it('does not serialize fitness file attachments in note payload', async () => {
      const status = (await createNoteFromUserInput({
        text: 'Post with mixed attachments',
        currentActor: actor1,
        attachments: [
          {
            type: 'upload',
            id: 'image-upload-id',
            mediaType: 'image/png',
            url: 'https://example.com/media/image.png',
            width: 640,
            height: 480,
            name: 'image.png'
          },
          {
            type: 'upload',
            id: 'fitness-upload-id',
            mediaType: 'application/tcx+xml',
            url: '/api/v1/fitness-files/fitness-file-id',
            width: 0,
            height: 0,
            name: 'training.tcx'
          }
        ],
        database
      })) as StatusNote

      const note = getNoteFromStatus(status) as Note
      const attachments = Array.isArray(note.attachment) ? note.attachment : []

      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        mediaType: 'image/png',
        url: 'https://example.com/media/image.png'
      })
    })

    it('federates only the first MAX_FEDERATION_MEDIA_ATTACHMENTS media even when the status stores more', async () => {
      const storedCount = MAX_FEDERATION_MEDIA_ATTACHMENTS + 1
      const status = (await createNoteFromUserInput({
        text: 'Post with more photos than Mastodon renders',
        currentActor: actor1,
        attachments: Array.from({ length: storedCount }, (_, index) => ({
          type: 'upload' as const,
          id: `overflow-image-${index}`,
          mediaType: 'image/png',
          url: `https://example.com/media/overflow-${index}.png`,
          width: 640,
          height: 480,
          name: `overflow-${index}.png`
        })),
        database
      })) as StatusNote

      // The status keeps every attachment locally...
      expect(status.attachments).toHaveLength(storedCount)

      // ...but the outbound ActivityPub note only carries the federation cap,
      // keeping the first N of the stored attachments in their stored order.
      const note = getNoteFromStatus(status) as Note
      const attachments = Array.isArray(note.attachment) ? note.attachment : []
      expect(attachments).toHaveLength(MAX_FEDERATION_MEDIA_ATTACHMENTS)
      const expectedUrls = status.attachments
        .slice(0, MAX_FEDERATION_MEDIA_ATTACHMENTS)
        .map((attachment) => attachment.url)
      expect(
        attachments.map((attachment) => (attachment as Document).url)
      ).toEqual(expectedUrls)
    })
  })
  describe('link preview scheduling', () => {
    // syncStatusLinkPreview returns void and swallows every error by design, so
    // without a test at the call site the whole feature can be deleted from
    // this action without a single failure anywhere.
    it('schedules a preview fetch for a link in the post', async () => {
      const status = (await createNoteFromUserInput({
        text: 'Reading https://example.com/link-preview-wiring today',
        currentActor: actor1,
        visibility: 'public',
        database
      })) as StatusNote

      const publishedNames = vi
        .mocked(getQueue().publish)
        .mock.calls.map(([message]) => message.name)
      expect(publishedNames).toContain(FETCH_LINK_PREVIEW_JOB_NAME)

      const previewMessage = vi
        .mocked(getQueue().publish)
        .mock.calls.map(([message]) => message)
        .find((message) => message.name === FETCH_LINK_PREVIEW_JOB_NAME)
      expect(previewMessage?.data).toEqual({
        statusId: status.id,
        url: 'https://example.com/link-preview-wiring'
      })
    })

    it('schedules nothing for a post with no link', async () => {
      await createNoteFromUserInput({
        text: 'Just some words, no links at all',
        currentActor: actor1,
        visibility: 'public',
        database
      })

      const publishedNames = vi
        .mocked(getQueue().publish)
        .mock.calls.map(([message]) => message.name)
      expect(publishedNames).not.toContain(FETCH_LINK_PREVIEW_JOB_NAME)
    })
  })
})
