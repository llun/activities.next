import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { updateNoteFromUserInput } from '@/lib/actions/updateNote'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getFederatedStatusDeliveryInboxes } from '@/lib/services/federation/statusDelivery'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { getQueue } from '@/lib/services/queue'
import * as timelinesService from '@/lib/services/timelines'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { seedActor3 } from '@/lib/stub/seed/actor3'
import { seedActor4 } from '@/lib/stub/seed/actor4'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'

enableFetchMocks()

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

describe('Update note action', () => {
  const { database, prepare } = createTestDatabase()
  let actor1: Actor | null | undefined

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    vi.clearAllMocks()
  })

  describe('updateNoteFromUserInput', () => {
    it('update status to new text', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/post-update-single-edit`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: actor1.id,
        text: '<p>Initial text</p>',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const status = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        text: '<p>This is an updated note</p>'
      })) as Status

      expect(status).toMatchObject({
        actorId: actor1.id,
        text: '<p>This is an updated note</p>',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        edits: expect.toBeArrayOfSize(1)
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(`${statusId}#update/${status?.updatedAt}`),
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId
        }
      })
      expect(timelinesService.addStatusToTimelines).toHaveBeenCalledWith(
        database,
        status
      )
    })

    it('format text when updating text', async () => {
      if (!actor1) fail('Actor1 is required')

      const status = await updateNoteFromUserInput({
        statusId: `${actor1.id}/statuses/post-1`,
        currentActor: actor1,
        database,
        text: 'This is markdown **text** that should get format'
      })

      expect(status).toMatchObject({
        text: 'This is markdown **text** that should get format'
      })
    })

    it('re-detects the content language when the edited text changes', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/post-1`

      const status = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        text: 'สวัสดีครับ ผมชื่อจอห์น ผมเป็นนักพัฒนาซอฟต์แวร์ที่ทำงานในกรุงเทพมหานคร',
        language: 'en'
      })) as Status

      expect(status).toMatchObject({
        language: 'en',
        detectedLanguage: 'th'
      })
    })

    it('does not let a stored language suppress detection on an edit that omits language', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/post-1`

      await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        text: 'Short',
        language: 'id'
      })
      const status = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        text: 'Hello, my name is John and I am a software developer working in Bangkok'
      })) as Status

      expect(status).toMatchObject({ language: 'id', detectedLanguage: 'en' })
    })

    it('clears a stale detected language when the edit no longer detects confidently', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/post-1`

      const detected = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        text: 'สวัสดีครับ ผมชื่อจอห์น ผมเป็นนักพัฒนาซอฟต์แวร์ที่ทำงานในกรุงเทพมหานคร'
      })) as Status
      expect(detected).toMatchObject({ detectedLanguage: 'th' })

      const edited = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        text: 'ok'
      })) as Status

      expect(edited).toMatchObject({ text: 'ok', detectedLanguage: null })
    })

    it('updates content warning without changing text', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/post-1`
      const before = await database.getStatus({ statusId })
      if (!before || before.type !== 'Note') fail('Note is required')

      const status = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        summary: 'Updated warning'
      })) as Status

      expect(status).toMatchObject({
        text: before.text,
        summary: 'Updated warning'
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(`${statusId}#update/${status?.updatedAt}`),
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId
        }
      })
    })

    it('does not publish when publish is false', async () => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/post-1`

      const status = (await updateNoteFromUserInput({
        statusId,
        currentActor: actor1,
        database,
        summary: 'Draft warning',
        publish: false
      })) as Status

      expect(status).toMatchObject({
        summary: 'Draft warning'
      })
      expect(timelinesService.addStatusToTimelines).toHaveBeenCalledWith(
        database,
        status
      )
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('notifies local authors of accepted quotes when the status is edited', async () => {
      if (!actor1) fail('Actor1 is required')
      const actor2 = (await database.getActorFromUsername({
        username: seedActor2.username,
        domain: seedActor2.domain
      })) as Actor
      const quotedId = `${actor1.id}/statuses/quoted-update-edit`
      await database.createNote({
        id: quotedId,
        url: quotedId,
        actorId: actor1.id,
        text: 'quoted',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const quotingId = `${actor2.id}/statuses/quoted-update-quoting`
      await database.createNote({
        id: quotingId,
        url: quotingId,
        actorId: actor2.id,
        text: 'quoting',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createStatusQuote({
        statusId: quotingId,
        quotedStatusId: quotedId,
        state: 'accepted'
      })

      await updateNoteFromUserInput({
        statusId: quotedId,
        currentActor: actor1,
        database,
        text: 'quoted (edited)'
      })

      const notifications = await database.getNotifications({
        actorId: actor2.id,
        limit: 100,
        types: ['quoted_update']
      })
      expect(
        notifications.filter((n) => n.statusId === quotingId)
      ).toHaveLength(1)
    })

    it('does not notify quoters when publish is false', async () => {
      if (!actor1) fail('Actor1 is required')
      const actor2 = (await database.getActorFromUsername({
        username: seedActor2.username,
        domain: seedActor2.domain
      })) as Actor
      const quotedId = `${actor1.id}/statuses/quoted-update-draft`
      await database.createNote({
        id: quotedId,
        url: quotedId,
        actorId: actor1.id,
        text: 'quoted',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const quotingId = `${actor2.id}/statuses/quoted-update-draft-quoting`
      await database.createNote({
        id: quotingId,
        url: quotingId,
        actorId: actor2.id,
        text: 'quoting',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createStatusQuote({
        statusId: quotingId,
        quotedStatusId: quotedId,
        state: 'accepted'
      })

      await updateNoteFromUserInput({
        statusId: quotedId,
        currentActor: actor1,
        database,
        summary: 'Draft warning',
        publish: false
      })

      const notifications = await database.getNotifications({
        actorId: actor2.id,
        limit: 100,
        types: ['quoted_update']
      })
      expect(
        notifications.filter((n) => n.statusId === quotingId)
      ).toHaveLength(0)
    })

    // The attachment row snapshots the media row's BlurHash, focal point and
    // thumbnail, and every reader (the Mastodon serializer, the timeline's
    // Media component) serves that snapshot rather than the media row. An edit
    // that rewrote only the alt text left a focal point a client had just
    // dragged unreadable on the status.
    describe('attachment media snapshot', () => {
      const createOwnedMedia = async ({
        path,
        blurhash,
        focus
      }: {
        path: string
        blurhash?: string
        focus?: { x: number; y: number }
      }) => {
        if (!actor1) fail('Actor1 is required')
        const media = await database.createMedia({
          actorId: actor1.id,
          original: {
            path,
            bytes: 5000,
            mimeType: 'image/png',
            metaData: { width: 800, height: 600 }
          },
          thumbnail: {
            path: `${path}-thumbnail.webp`,
            bytes: 500,
            mimeType: 'image/webp',
            metaData: { width: 200, height: 150 }
          },
          ...(blurhash ? { blurhash } : {}),
          ...(focus ? { focus } : {})
        })
        if (!media) fail('Media is required')
        return media
      }

      const attachmentInput = (mediaId: string, name: string) => ({
        type: 'upload' as const,
        id: mediaId,
        mediaType: 'image/png',
        url: `https://llun.test/api/v1/files/${mediaId}.png`,
        width: 800,
        height: 600,
        name
      })

      it('copies the media snapshot onto an attachment added by the edit', async () => {
        if (!actor1) fail('Actor1 is required')
        const statusId = `${actor1.id}/statuses/post-edit-add-attachment`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: actor1.id,
          text: 'before the edit',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        const media = await createOwnedMedia({
          path: 'medias/edit-added.png',
          blurhash: 'LEHV6nWB2yk8pyo0adR*',
          focus: { x: -0.5, y: 0.25 }
        })

        await updateNoteFromUserInput({
          statusId,
          currentActor: actor1,
          database,
          attachments: [attachmentInput(media.id, 'added in the edit')],
          publish: false
        })

        const attachments = await database.getAttachments({ statusId })
        expect(attachments).toHaveLength(1)
        expect(attachments[0]).toMatchObject({
          mediaId: media.id,
          blurhash: 'LEHV6nWB2yk8pyo0adR*',
          focus: { x: -0.5, y: 0.25 },
          thumbnailUrl: expect.stringContaining(
            'medias/edit-added.png-thumbnail.webp'
          )
        })
      })

      it('refreshes the snapshot of a kept attachment when the media focus changes', async () => {
        if (!actor1) fail('Actor1 is required')
        const statusId = `${actor1.id}/statuses/post-edit-keep-attachment`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: actor1.id,
          text: 'before the edit',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        const media = await createOwnedMedia({
          path: 'medias/edit-kept.png',
          blurhash: 'LEHV6nWB2yk8pyo0adR*',
          focus: { x: 0, y: 0 }
        })
        await database.createAttachment({
          actorId: actor1.id,
          statusId,
          mediaType: 'image/png',
          url: `https://llun.test/api/v1/files/${media.id}.png`,
          width: 800,
          height: 600,
          name: 'unchanged alt text',
          mediaId: media.id,
          blurhash: 'LEHV6nWB2yk8pyo0adR*',
          focus: { x: 0, y: 0 },
          thumbnailUrl: `https://llun.test/api/v1/files/medias/edit-kept.png-thumbnail.webp`
        })

        // What PUT /api/v1/statuses/:id does for media_attributes[][focus]
        // before it resolves the attachments.
        await database.updateMedia({
          mediaId: media.id,
          accountId: actor1.account?.id ?? '',
          focus: { x: 0.75, y: -0.75 }
        })

        await updateNoteFromUserInput({
          statusId,
          currentActor: actor1,
          database,
          attachments: [attachmentInput(media.id, 'unchanged alt text')],
          publish: false
        })

        const attachments = await database.getAttachments({ statusId })
        expect(attachments).toHaveLength(1)
        expect(attachments[0].focus).toEqual({ x: 0.75, y: -0.75 })
      })

      it('leaves an untouched attachment row alone', async () => {
        if (!actor1) fail('Actor1 is required')
        const statusId = `${actor1.id}/statuses/post-edit-untouched-attachment`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: actor1.id,
          text: 'before the edit',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        const media = await createOwnedMedia({
          path: 'medias/edit-untouched.png',
          blurhash: 'LEHV6nWB2yk8pyo0adR*'
        })
        const thumbnailUrl =
          'https://llun.test/api/v1/files/medias/edit-untouched.png-thumbnail.webp'
        await database.createAttachment({
          actorId: actor1.id,
          statusId,
          mediaType: 'image/png',
          url: `https://llun.test/api/v1/files/${media.id}.png`,
          width: 800,
          height: 600,
          name: 'unchanged alt text',
          mediaId: media.id,
          blurhash: 'LEHV6nWB2yk8pyo0adR*',
          thumbnailUrl
        })
        const [before] = await database.getAttachments({ statusId })

        await updateNoteFromUserInput({
          statusId,
          currentActor: actor1,
          database,
          text: 'after the edit',
          attachments: [attachmentInput(media.id, 'unchanged alt text')],
          publish: false
        })

        const [after] = await database.getAttachments({ statusId })
        expect(after.id).toEqual(before.id)
        expect(after.updatedAt).toEqual(before.updatedAt)
        expect(after.blurhash).toEqual('LEHV6nWB2yk8pyo0adR*')
        expect(after.thumbnailUrl).toEqual(thumbnailUrl)
      })
    })

    describe('hashtag and mention sync on text edits', () => {
      let actor2: Actor
      let actor3: Actor
      let actor4: Actor

      beforeAll(async () => {
        actor2 = (await database.getActorFromUsername({
          username: seedActor2.username,
          domain: seedActor2.domain
        })) as Actor
        actor3 = (await database.getActorFromUsername({
          username: seedActor3.username,
          domain: seedActor3.domain
        })) as Actor
        actor4 = (await database.getActorFromUsername({
          username: seedActor4.username,
          domain: seedActor4.domain
        })) as Actor
      })

      it('adds a hashtag on edit, increments its counter and indexes it, and decrements when removed', async () => {
        if (!actor1) fail('Actor1 is required')

        const created = (await createNoteFromUserInput({
          text: 'Initial note without hashtags',
          currentActor: actor1,
          database
        })) as StatusNote
        expect(
          await database.getHashtagCounter({ hashtag: 'solsticebloom' })
        ).toBe(0)

        const added = (await updateNoteFromUserInput({
          statusId: created.id,
          currentActor: actor1,
          database,
          text: 'Updated note with #SolsticeBloom'
        })) as StatusNote

        expect(added.tags).toEqual([
          expect.objectContaining({
            type: 'hashtag',
            name: '#SolsticeBloom',
            value: 'https://llun.test/tags/solsticebloom'
          })
        ])
        expect(
          await database.getHashtagCounter({ hashtag: 'solsticebloom' })
        ).toBe(1)
        expect(
          await database.searchHashtags({
            q: 'solsticebloom',
            limit: 10,
            offset: 0
          })
        ).toEqual([expect.objectContaining({ name: 'solsticebloom' })])

        const removed = (await updateNoteFromUserInput({
          statusId: created.id,
          currentActor: actor1,
          database,
          text: 'Updated note after removing hashtag'
        })) as StatusNote

        expect(removed.tags).toEqual([])
        expect(
          await database.getHashtagCounter({ hashtag: 'solsticebloom' })
        ).toBe(0)
        expect(
          await database.searchHashtags({
            q: 'solsticebloom',
            limit: 10,
            offset: 0
          })
        ).toEqual([])
      })

      it('moves no hashtag counter when editing a followers-only or direct status', async () => {
        if (!actor1) fail('Actor1 is required')

        const privateNote = (await createNoteFromUserInput({
          text: 'Followers-only note',
          currentActor: actor1,
          visibility: 'private',
          database
        })) as StatusNote
        const directNote = (await createNoteFromUserInput({
          text: '@test2@llun.test direct note',
          currentActor: actor1,
          visibility: 'direct',
          database
        })) as StatusNote
        const unlistedNote = (await createNoteFromUserInput({
          text: 'Unlisted note',
          currentActor: actor1,
          visibility: 'unlisted',
          database
        })) as StatusNote

        const editedPrivate = (await updateNoteFromUserInput({
          statusId: privateNote.id,
          currentActor: actor1,
          database,
          text: 'Followers-only note #quietorchard'
        })) as StatusNote
        const editedDirect = (await updateNoteFromUserInput({
          statusId: directNote.id,
          currentActor: actor1,
          database,
          text: '@test2@llun.test direct note #quietorchard'
        })) as StatusNote

        expect(
          editedPrivate.tags.map((tag) => ({ type: tag.type, name: tag.name }))
        ).toContainEqual({ type: 'hashtag', name: '#quietorchard' })
        expect(
          editedDirect.tags.map((tag) => ({ type: tag.type, name: tag.name }))
        ).toContainEqual({ type: 'hashtag', name: '#quietorchard' })
        expect(
          await database.getHashtagCounter({ hashtag: 'quietorchard' })
        ).toBe(0)

        await updateNoteFromUserInput({
          statusId: privateNote.id,
          currentActor: actor1,
          database,
          text: 'Followers-only note cleared'
        })
        await updateNoteFromUserInput({
          statusId: directNote.id,
          currentActor: actor1,
          database,
          text: '@test2@llun.test direct note cleared'
        })
        expect(
          await database.getHashtagCounter({ hashtag: 'quietorchard' })
        ).toBe(0)

        await updateNoteFromUserInput({
          statusId: unlistedNote.id,
          currentActor: actor1,
          database,
          text: 'Unlisted note #quietorchard'
        })
        expect(
          await database.getHashtagCounter({ hashtag: 'quietorchard' })
        ).toBe(1)
      })

      it('reflects the new hashtags and mentions in the returned status and federated Note tags', async () => {
        if (!actor1) fail('Actor1 is required')

        const created = (await createNoteFromUserInput({
          text: 'Hello @test2@llun.test #earlyseed',
          currentActor: actor1,
          database
        })) as StatusNote

        const updated = (await updateNoteFromUserInput({
          statusId: created.id,
          currentActor: actor1,
          database,
          text: 'Hello @test3@llun.test #latesprout'
        })) as StatusNote

        expect(
          updated.tags.map((tag) => ({
            type: tag.type,
            name: tag.name,
            value: tag.value
          }))
        ).toEqual(
          expect.arrayContaining([
            {
              type: 'mention',
              name: '@test3@llun.test',
              value: actor3.id
            },
            {
              type: 'hashtag',
              name: '#latesprout',
              value: 'https://llun.test/tags/latesprout'
            }
          ])
        )
        expect(updated.tags).toHaveLength(2)

        const federatedNote = getNoteFromStatus(updated)
        expect(federatedNote?.tag).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'Mention',
              href: actor3.id
            }),
            expect.objectContaining({
              type: 'Hashtag',
              name: '#latesprout'
            })
          ])
        )
        expect(federatedNote?.tag).toHaveLength(2)
      })

      it('notifies a newly mentioned local user once while leaving a previously mentioned user un-notified', async () => {
        if (!actor1) fail('Actor1 is required')

        const parent = (await createNoteFromUserInput({
          text: 'Parent note from test2',
          currentActor: actor2,
          database
        })) as StatusNote
        const reply = (await createNoteFromUserInput({
          text: '@test2@llun.test initial reply',
          currentActor: actor1,
          replyNoteId: parent.id,
          database
        })) as StatusNote
        // The create dispatches the reply alert fire-and-forget; wait for that
        // exact dispatch so the clear below leaves only the edit's alert.
        await vi.waitFor(() =>
          expect(sendNotificationAlerts).toHaveBeenCalledWith(
            expect.objectContaining({
              actorId: actor2.id,
              statusId: reply.id
            })
          )
        )
        vi.mocked(sendNotificationAlerts).mockClear()

        await updateNoteFromUserInput({
          statusId: reply.id,
          currentActor: actor1,
          database,
          text: '@test2@llun.test edited reply looping in @test3@llun.test'
        })

        const actor3Notifications = (
          await database.getNotifications({ actorId: actor3.id, limit: 100 })
        ).filter((n) => n.statusId === reply.id)
        expect(actor3Notifications).toHaveLength(1)
        expect(actor3Notifications[0]).toMatchObject({
          type: NotificationType.enum.mention,
          sourceActorId: actor1.id,
          groupKey: `mention:${reply.id}`
        })
        expect(vi.mocked(sendNotificationAlerts)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(sendNotificationAlerts)).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: actor3.id,
            sourceActorId: actor1.id,
            statusId: reply.id,
            events: [
              expect.objectContaining({
                type: NotificationType.enum.mention,
                notificationId: actor3Notifications[0].id
              })
            ]
          })
        )

        // actor2 had one reply notification from create time and gets neither a
        // duplicate reply notification nor a mention notification on edit.
        const actor2Notifications = (
          await database.getNotifications({ actorId: actor2.id, limit: 100 })
        ).filter((n) => n.statusId === reply.id)
        expect(actor2Notifications).toHaveLength(1)
        expect(actor2Notifications[0].type).toBe(NotificationType.enum.reply)
      })

      it('creates no second notification when retrying the same edit or when a mention notification already exists', async () => {
        if (!actor1) fail('Actor1 is required')

        const created = (await createNoteFromUserInput({
          text: 'Note before mention',
          currentActor: actor1,
          database
        })) as StatusNote
        // The create names nobody, so it dispatches no alert at all.
        expect(sendNotificationAlerts).not.toHaveBeenCalled()

        await updateNoteFromUserInput({
          statusId: created.id,
          currentActor: actor1,
          database,
          text: 'Hello @test3@llun.test'
        })

        const afterFirstEdit = (
          await database.getNotifications({ actorId: actor3.id, limit: 100 })
        ).filter((n) => n.statusId === created.id)
        expect(afterFirstEdit).toHaveLength(1)
        vi.mocked(sendNotificationAlerts).mockClear()

        // Retry with the exact same text.
        await updateNoteFromUserInput({
          statusId: created.id,
          currentActor: actor1,
          database,
          text: 'Hello @test3@llun.test'
        })

        const afterRetry = (
          await database.getNotifications({ actorId: actor3.id, limit: 100 })
        ).filter((n) => n.statusId === created.id)
        expect(afterRetry).toHaveLength(1)
        expect(vi.mocked(sendNotificationAlerts)).not.toHaveBeenCalled()

        // Simulate a partial-failure state where the stored mention tags were
        // cleared while the mention:<statusId> notification row already exists.
        await database.deleteStatusTagsByType({
          statusId: created.id,
          type: 'mention'
        })
        await updateNoteFromUserInput({
          statusId: created.id,
          currentActor: actor1,
          database,
          text: 'Hello @test3@llun.test'
        })

        const afterPartialRecovery = (
          await database.getNotifications({ actorId: actor3.id, limit: 100 })
        ).filter((n) => n.statusId === created.id)
        expect(afterPartialRecovery).toHaveLength(1)
        expect(vi.mocked(sendNotificationAlerts)).not.toHaveBeenCalled()
      })

      it('does not notify a newly mentioned local user who blocks or mutes the author with notifications=true', async () => {
        if (!actor1) fail('Actor1 is required')

        await database.createBlock({
          actorId: actor2.id,
          targetActorId: actor1.id,
          uri: `${actor2.id}#blocks/edit-mention-block`
        })
        await database.createMute({
          actorId: actor3.id,
          targetActorId: actor1.id,
          notifications: true,
          endsAt: null
        })

        try {
          const created = (await createNoteFromUserInput({
            text: 'Plain note before mentions',
            currentActor: actor1,
            database
          })) as StatusNote
          // The create names nobody, so it dispatches no alert at all.
          expect(sendNotificationAlerts).not.toHaveBeenCalled()

          await updateNoteFromUserInput({
            statusId: created.id,
            currentActor: actor1,
            database,
            text: 'Pinging @test2@llun.test @test3@llun.test and @test4@llun.test'
          })

          const blockedNotifications = (
            await database.getNotifications({ actorId: actor2.id, limit: 100 })
          ).filter((n) => n.statusId === created.id)
          const mutedNotifications = (
            await database.getNotifications({ actorId: actor3.id, limit: 100 })
          ).filter((n) => n.statusId === created.id)
          const eligibleNotifications = (
            await database.getNotifications({ actorId: actor4.id, limit: 100 })
          ).filter((n) => n.statusId === created.id)

          expect(blockedNotifications).toHaveLength(0)
          expect(mutedNotifications).toHaveLength(0)
          expect(eligibleNotifications).toHaveLength(1)
          expect(vi.mocked(sendNotificationAlerts)).toHaveBeenCalledTimes(1)
          expect(vi.mocked(sendNotificationAlerts)).toHaveBeenCalledWith(
            expect.objectContaining({
              actorId: actor4.id,
              statusId: created.id
            })
          )
        } finally {
          await database.deleteBlock({
            actorId: actor2.id,
            targetActorId: actor1.id
          })
          await database.deleteMute({
            actorId: actor3.id,
            targetActorId: actor1.id
          })
        }
      })

      it('adds a newly mentioned remote actor to cc for public and to for direct so SEND_UPDATE_NOTE delivery reaches them', async () => {
        if (!actor1) fail('Actor1 is required')

        const publicNote = (await createNoteFromUserInput({
          text: 'Public note before remote mention',
          currentActor: actor1,
          database
        })) as StatusNote

        const updatedPublic = (await updateNoteFromUserInput({
          statusId: publicNote.id,
          currentActor: actor1,
          database,
          text: 'Public note mentioning @cedarpine@grove.example and self @test1@llun.test'
        })) as StatusNote

        const remotePublicActorId = 'https://grove.example/users/cedarpine'
        expect(updatedPublic.cc).toContain(remotePublicActorId)
        expect(updatedPublic.to).not.toContain(actor1.id)
        expect(updatedPublic.cc).not.toContain(actor1.id)

        const publicInboxes = await getFederatedStatusDeliveryInboxes({
          database,
          currentActor: actor1,
          status: updatedPublic
        })
        expect(publicInboxes).toContain('https://grove.example/inbox')

        const directNote = (await createNoteFromUserInput({
          text: '@test2@llun.test direct note before remote mention',
          currentActor: actor1,
          visibility: 'direct',
          database
        })) as StatusNote

        const updatedDirect = (await updateNoteFromUserInput({
          statusId: directNote.id,
          currentActor: actor1,
          database,
          text: '@test2@llun.test @birchleaf@orchard.example direct note'
        })) as StatusNote

        const remoteDirectActorId = 'https://orchard.example/users/birchleaf'
        expect(updatedDirect.to).toEqual(
          expect.arrayContaining([actor2.id, remoteDirectActorId])
        )
        expect(updatedDirect.to).toHaveLength(2)
        expect(updatedDirect.cc).toEqual([])

        const directInboxes = await getFederatedStatusDeliveryInboxes({
          database,
          currentActor: actor1,
          status: updatedDirect
        })
        expect(directInboxes).toContain('https://orchard.example/inbox')
      })

      it('removes a deleted mention tag while keeping the recipient in to/cc', async () => {
        if (!actor1) fail('Actor1 is required')

        const remoteActorId = 'https://grove.example/users/maplefern'
        const publicNote = (await createNoteFromUserInput({
          text: 'Hello @maplefern@grove.example',
          currentActor: actor1,
          database
        })) as StatusNote
        expect(publicNote.cc).toContain(remoteActorId)
        expect(publicNote.tags.map((t) => t.value)).toContain(remoteActorId)

        const editedPublic = (await updateNoteFromUserInput({
          statusId: publicNote.id,
          currentActor: actor1,
          database,
          text: 'Removed the mention from text'
        })) as StatusNote

        expect(
          editedPublic.tags.filter((tag) => tag.type === 'mention')
        ).toEqual([])
        expect(editedPublic.cc).toContain(remoteActorId)

        const directNote = (await createNoteFromUserInput({
          text: '@test2@llun.test @maplefern@grove.example secret chat',
          currentActor: actor1,
          visibility: 'direct',
          database
        })) as StatusNote
        expect(directNote.to).toEqual(
          expect.arrayContaining([actor2.id, remoteActorId])
        )
        expect(directNote.to).toHaveLength(2)

        const editedDirect = (await updateNoteFromUserInput({
          statusId: directNote.id,
          currentActor: actor1,
          database,
          text: '@test2@llun.test secret chat with one mention removed'
        })) as StatusNote

        expect(
          editedDirect.tags
            .filter((tag) => tag.type === 'mention')
            .map((tag) => tag.value)
        ).toEqual([actor2.id])
        expect(editedDirect.to).toEqual(
          expect.arrayContaining([actor2.id, remoteActorId])
        )
        expect(editedDirect.to).toHaveLength(2)
      })

      it('keeps edit history when a public post gains a mention but drops it for a followers-only post', async () => {
        if (!actor1) fail('Actor1 is required')

        const publicNote = (await createNoteFromUserInput({
          text: 'Public note before mention',
          currentActor: actor1,
          database
        })) as StatusNote
        const publicFirstEdit = (await updateNoteFromUserInput({
          statusId: publicNote.id,
          currentActor: actor1,
          database,
          text: 'Public note first edit'
        })) as StatusNote
        expect(publicFirstEdit.edits).toHaveLength(1)

        const publicSecondEdit = (await updateNoteFromUserInput({
          statusId: publicNote.id,
          currentActor: actor1,
          database,
          text: 'Public note first edit mentioning @cedarpine@grove.example'
        })) as StatusNote
        expect(publicSecondEdit.edits).toHaveLength(2)

        const privateNote = (await createNoteFromUserInput({
          text: 'Followers-only note before mention',
          currentActor: actor1,
          visibility: 'private',
          database
        })) as StatusNote
        const privateFirstEdit = (await updateNoteFromUserInput({
          statusId: privateNote.id,
          currentActor: actor1,
          database,
          text: 'Followers-only note first edit'
        })) as StatusNote
        expect(privateFirstEdit.edits).toHaveLength(1)

        const privateSecondEdit = (await updateNoteFromUserInput({
          statusId: privateNote.id,
          currentActor: actor1,
          database,
          text: 'Followers-only note first edit mentioning @cedarpine@grove.example'
        })) as StatusNote
        expect(privateSecondEdit.edits).toHaveLength(0)
      })

      it('keeps a stored mention tag when webfinger fails but the text still names the account', async () => {
        if (!actor1) fail('Actor1 is required')

        const remoteActorId = 'https://grove.example/users/maplefern'
        const note = (await createNoteFromUserInput({
          text: 'Hello @maplefern@grove.example',
          currentActor: actor1,
          database
        })) as StatusNote
        expect(note.tags.map((tag) => tag.value)).toContain(remoteActorId)

        // Every webfinger lookup fails for the edits below.
        fetchMock.mockResponse(async () => ({ status: 404 }))

        const kept = (await updateNoteFromUserInput({
          statusId: note.id,
          currentActor: actor1,
          database,
          text: 'Hello again @maplefern@grove.example'
        })) as StatusNote
        expect(kept.tags.filter((tag) => tag.type === 'mention')).toEqual([
          expect.objectContaining({
            name: '@maplefern@grove.example',
            value: remoteActorId
          })
        ])

        const removed = (await updateNoteFromUserInput({
          statusId: note.id,
          currentActor: actor1,
          database,
          text: 'Hello again without the handle'
        })) as StatusNote
        expect(removed.tags.filter((tag) => tag.type === 'mention')).toEqual([])
      })

      it('does not keep a stored mention tag when the text only names a longer handle sharing its prefix', async () => {
        if (!actor1) fail('Actor1 is required')

        const remoteActorId = 'https://grove.example/users/maplefern'
        const note = (await createNoteFromUserInput({
          text: 'Hello @maplefern@grove.example',
          currentActor: actor1,
          database
        })) as StatusNote
        expect(note.tags.map((tag) => tag.value)).toContain(remoteActorId)

        // Every webfinger lookup fails, so the longer handle does not resolve
        // either. The stored tag names a different account and must not be kept
        // just because its name is a prefix of the one the text names.
        fetchMock.mockResponse(async () => ({ status: 404 }))

        const updated = (await updateNoteFromUserInput({
          statusId: note.id,
          currentActor: actor1,
          database,
          text: 'Hello @maplefern@grove.example.extra'
        })) as StatusNote

        expect(updated.tags.filter((tag) => tag.type === 'mention')).toEqual([])
      })

      it('does not notify an inherited direct-thread recipient the status does not address', async () => {
        if (!actor1) fail('Actor1 is required')

        const parentId = `${actor1.id}/statuses/direct-parent-for-edit`
        await database.createNote({
          id: parentId,
          url: parentId,
          actorId: actor1.id,
          text: 'Direct parent',
          to: [actor2.id],
          cc: []
        })

        // A self-reply that names nobody inherits the parent's recipients as
        // mention tags, but they are not added to this status's to/cc.
        const replyId = `${actor1.id}/statuses/direct-reply-for-edit`
        await database.createNote({
          id: replyId,
          url: replyId,
          actorId: actor1.id,
          text: 'Direct reply',
          to: [actor1.id],
          cc: [],
          reply: parentId
        })

        await updateNoteFromUserInput({
          statusId: replyId,
          currentActor: actor1,
          database,
          text: 'Direct reply edited'
        })

        const actor2Notifications = (
          await database.getNotifications({ actorId: actor2.id, limit: 100 })
        ).filter((notification) => notification.statusId === replyId)
        expect(actor2Notifications).toHaveLength(0)
      })

      it('moves no hashtag counter for a stored legacy bare `Public` row', async () => {
        if (!actor1) fail('Actor1 is required')

        const statusId = `${actor1.id}/statuses/legacy-bare-public-edit`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: actor1.id,
          text: 'Legacy bare public note',
          to: ['Public'],
          cc: []
        })

        const updated = (await updateNoteFromUserInput({
          statusId,
          currentActor: actor1,
          database,
          text: 'Legacy bare public note #barepublictag'
        })) as StatusNote

        expect(updated.tags.map((tag) => tag.name)).toContain('#barepublictag')
        expect(
          await database.getHashtagCounter({ hashtag: 'barepublictag' })
        ).toBe(0)
      })

      it('still returns the status and queues the update when a tag insert fails', async () => {
        if (!actor1) fail('Actor1 is required')

        const created = (await createNoteFromUserInput({
          text: 'Note before a failing tag insert',
          currentActor: actor1,
          database
        })) as StatusNote

        const originalCreateTag = database.createTag.bind(database)
        const createTagSpy = vi
          .spyOn(database, 'createTag')
          .mockImplementation(async (params) => {
            if (params.type === 'hashtag') {
              throw new Error('tag insert failed')
            }
            return originalCreateTag(params)
          })

        try {
          const updated = await updateNoteFromUserInput({
            statusId: created.id,
            currentActor: actor1,
            database,
            text: 'Note with #failingtag'
          })

          expect(updated).toMatchObject({ id: created.id })
          expect(getQueue().publish).toHaveBeenCalledWith(
            expect.objectContaining({
              name: SEND_UPDATE_NOTE_JOB_NAME,
              data: { actorId: actor1.id, statusId: created.id }
            })
          )
          expect(timelinesService.addStatusToTimelines).toHaveBeenCalled()
          // The counter follows what is stored: the tag insert failed, so the
          // hashtag is not on the status and its counter must not move.
          expect(
            await database.getHashtagCounter({ hashtag: 'failingtag' })
          ).toBe(0)
        } finally {
          createTagSpy.mockRestore()
        }
      })
    })
  })
})
