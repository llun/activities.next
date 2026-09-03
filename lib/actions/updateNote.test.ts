import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { updateNoteFromUserInput } from '@/lib/actions/updateNote'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import * as timelinesService from '@/lib/services/timelines'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

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
  const database = getTestSQLDatabase()
  let actor1: Actor | undefined

  beforeAll(async () => {
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
      const statusId = `${actor1.id}/statuses/post-1`

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
  })
})
