import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { getQueue } from '@/lib/services/queue'
import * as timelinesService from '@/lib/services/timelines'
import { mockRequests } from '@/lib/stub/activities'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { Note } from '@/lib/types/activitypub'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'

enableFetchMocks()

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: jest.fn()
}))

describe('Create note action', () => {
  const database = getTestSQLDatabase()
  const mockSendNotificationAlerts =
    sendNotificationAlerts as jest.MockedFunction<typeof sendNotificationAlerts>
  let actor1: Actor
  let actor2: Actor

  const clearSettledNotificationAlerts = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    mockSendNotificationAlerts.mockClear()
  }

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
    actor2 = (await database.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
    })) as Actor
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    jest.clearAllMocks()
  })

  describe('#createNoteFromUserInput', () => {
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

    describe('visibility support', () => {
      it('creates public status with correct recipients', async () => {
        const status = (await createNoteFromUserInput({
          text: 'Public post',
          currentActor: actor1,
          visibility: 'public',
          database
        })) as StatusNote

        expect(status).toMatchObject({
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${actor1.id}/followers`]
        })
      })

      it('creates unlisted status with Public in cc', async () => {
        const status = (await createNoteFromUserInput({
          text: 'Unlisted post',
          currentActor: actor1,
          visibility: 'unlisted',
          database
        })) as StatusNote

        expect(status).toMatchObject({
          to: [`${actor1.id}/followers`],
          cc: [ACTIVITY_STREAM_PUBLIC]
        })
      })

      it('creates private status without Public', async () => {
        const status = (await createNoteFromUserInput({
          text: 'Private post',
          currentActor: actor1,
          visibility: 'private',
          database
        })) as StatusNote

        expect(status).toMatchObject({
          to: [`${actor1.id}/followers`],
          cc: []
        })
        expect(status.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
        expect(status.cc).not.toContain(ACTIVITY_STREAM_PUBLIC)
      })

      it('creates direct message with only mentioned users', async () => {
        const status = (await createNoteFromUserInput({
          text: '@test2@llun.test Hello!',
          currentActor: actor1,
          visibility: 'direct',
          database
        })) as StatusNote

        expect(status.to).toContain(ACTOR2_ID)
        expect(status.cc).toEqual([])
        expect(status.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
        expect(status.to).not.toContain(`${actor1.id}/followers`)
      })

      it('only notifies explicit direct recipients when direct replying to a non-direct parent', async () => {
        await clearSettledNotificationAlerts()
        const parentStatus = (await createNoteFromUserInput({
          text: 'Public parent from actor2',
          currentActor: actor2,
          database
        })) as StatusNote

        const replyStatus = (await createNoteFromUserInput({
          text: '@test3@llun.test private side note',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          visibility: 'direct',
          database
        })) as StatusNote
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(replyStatus.to).toEqual([ACTOR3_ID])
        expect(replyStatus.cc).toEqual([])

        const parentAuthorNotifications = await database.getNotifications({
          actorId: actor2.id,
          limit: 100
        })
        expect(
          parentAuthorNotifications.filter(
            (notification) => notification.statusId === replyStatus.id
          )
        ).toHaveLength(0)

        const directRecipientNotifications = await database.getNotifications({
          actorId: ACTOR3_ID,
          limit: 100
        })
        expect(
          directRecipientNotifications.filter(
            (notification) =>
              notification.statusId === replyStatus.id &&
              notification.type === NotificationType.enum.mention
          )
        ).toHaveLength(1)
        expect(mockSendNotificationAlerts).not.toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: actor2.id,
            sourceActorId: actor1.id,
            statusId: replyStatus.id
          })
        )
        expect(mockSendNotificationAlerts).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: ACTOR3_ID,
            sourceActorId: actor1.id,
            statusId: replyStatus.id
          })
        )
      })

      it('still notifies the parent author when replying in an existing direct thread', async () => {
        await clearSettledNotificationAlerts()
        const parentStatus = (await createNoteFromUserInput({
          text: '@test1@llun.test Direct parent from actor2',
          currentActor: actor2,
          visibility: 'direct',
          database
        })) as StatusNote

        const replyStatus = (await createNoteFromUserInput({
          text: 'Reply to existing direct thread',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          database
        })) as StatusNote
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(replyStatus.to).toContain(actor2.id)
        expect(replyStatus.to).not.toContain(ACTIVITY_STREAM_PUBLIC)

        const parentAuthorNotifications = await database.getNotifications({
          actorId: actor2.id,
          limit: 100
        })
        expect(
          parentAuthorNotifications.filter(
            (notification) =>
              notification.statusId === replyStatus.id &&
              notification.type === NotificationType.enum.reply
          )
        ).toHaveLength(1)
        expect(mockSendNotificationAlerts).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: actor2.id,
            sourceActorId: actor1.id,
            statusId: replyStatus.id
          })
        )
      })

      it('notifies inherited group direct participants when replying without explicit mentions', async () => {
        await clearSettledNotificationAlerts()
        const parentStatus = await database.createNote({
          id: `${actor2.id}/statuses/direct-group-notification-parent`,
          url: `${actor2.id}/statuses/direct-group-notification-parent`,
          actorId: actor2.id,
          text: 'Direct group parent from actor2',
          to: [actor1.id],
          cc: [ACTOR3_ID]
        })

        const replyStatus = (await createNoteFromUserInput({
          text: 'Reply to the group thread',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          database
        })) as StatusNote
        await new Promise((resolve) => setTimeout(resolve, 0))

        const inheritedRecipientNotifications = await database.getNotifications(
          {
            actorId: ACTOR3_ID,
            limit: 100
          }
        )
        expect(
          inheritedRecipientNotifications.filter(
            (notification) =>
              notification.statusId === replyStatus.id &&
              notification.type === NotificationType.enum.mention
          )
        ).toHaveLength(1)
        expect(mockSendNotificationAlerts).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: ACTOR3_ID,
            sourceActorId: actor1.id,
            statusId: replyStatus.id
          })
        )
      })

      it('creates private post with mentions in cc', async () => {
        const status = (await createNoteFromUserInput({
          text: '@test2@llun.test Private hello!',
          currentActor: actor1,
          visibility: 'private',
          database
        })) as StatusNote

        expect(status).toMatchObject({
          to: [`${actor1.id}/followers`]
        })
        expect(status.cc).toContain(ACTOR2_ID)
        expect(status.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
        expect(status.cc).not.toContain(ACTIVITY_STREAM_PUBLIC)
      })

      it('creates unlisted post with mentions in cc', async () => {
        const status = (await createNoteFromUserInput({
          text: '@test2@llun.test Unlisted hello!',
          currentActor: actor1,
          visibility: 'unlisted',
          database
        })) as StatusNote

        expect(status).toMatchObject({
          to: [`${actor1.id}/followers`]
        })
        expect(status.cc).toContain(ACTIVITY_STREAM_PUBLIC)
        expect(status.cc).toContain(ACTOR2_ID)
      })

      it('defaults to public when no visibility specified', async () => {
        const status = (await createNoteFromUserInput({
          text: 'Default visibility',
          currentActor: actor1,
          database
        })) as StatusNote

        expect(status.to).toContain(ACTIVITY_STREAM_PUBLIC)
      })

      it('includes original author in recipients when replying to private post', async () => {
        // First create a private status from actor2
        const privateStatus = (await createNoteFromUserInput({
          text: 'Private message',
          currentActor: actor2,
          visibility: 'private',
          database
        })) as StatusNote

        // Reply to the private status with private visibility
        const replyStatus = (await createNoteFromUserInput({
          text: 'Reply to private',
          currentActor: actor1,
          replyNoteId: privateStatus.id,
          visibility: 'private',
          database
        })) as StatusNote

        // The original author (actor2) should be in the 'to' recipients
        expect(replyStatus.to).toContain(actor2.id)
        expect(replyStatus.to).toContain(`${actor1.id}/followers`)
      })

      it('includes original author in recipients when replying to unlisted post', async () => {
        // First create an unlisted status from actor2
        const unlistedStatus = (await createNoteFromUserInput({
          text: 'Unlisted message',
          currentActor: actor2,
          visibility: 'unlisted',
          database
        })) as StatusNote

        // Reply to the unlisted status with unlisted visibility
        const replyStatus = (await createNoteFromUserInput({
          text: 'Reply to unlisted',
          currentActor: actor1,
          replyNoteId: unlistedStatus.id,
          visibility: 'unlisted',
          database
        })) as StatusNote

        // The original author (actor2) should be in the 'to' recipients
        expect(replyStatus.to).toContain(actor2.id)
        expect(replyStatus.to).toContain(`${actor1.id}/followers`)
      })

      it('stores inherited direct reply recipients as mention tags', async () => {
        const parentStatus = await database.createNote({
          id: `${actor1.id}/statuses/direct-parent-note-mention-tags`,
          url: `${actor1.id}/statuses/direct-parent-note-mention-tags`,
          actorId: 'https://remote.test/actors/direct-sender',
          text: 'Direct parent with multiple recipients',
          to: [actor1.id, ACTOR2_ID],
          cc: [ACTOR3_ID]
        })

        const status = (await createNoteFromUserInput({
          text: 'Reply without manually rementioning everyone',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          database
        })) as StatusNote

        const mentionTags = await database.getTags({ statusId: status.id })

        expect(mentionTags).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'mention',
              value: ACTOR2_ID
            }),
            expect.objectContaining({
              type: 'mention',
              value: ACTOR3_ID
            }),
            expect.objectContaining({
              type: 'mention',
              value: parentStatus.actorId
            })
          ])
        )
        expect(mentionTags).not.toContainEqual(
          expect.objectContaining({
            type: 'mention',
            value: actor1.id
          })
        )
      })

      it('does not store non-direct parent audiences as mention tags', async () => {
        const parentStatus = await database.createNote({
          id: `${actor1.id}/statuses/private-parent-note-audience-tags`,
          url: `${actor1.id}/statuses/private-parent-note-audience-tags`,
          actorId: actor2.id,
          text: 'Private parent with another addressed actor',
          to: [`${actor2.id}/followers`],
          cc: [ACTOR3_ID]
        })

        const status = (await createNoteFromUserInput({
          text: 'Reply to private thread',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          database
        })) as StatusNote

        const mentionTags = await database.getTags({ statusId: status.id })

        expect(mentionTags).toContainEqual(
          expect.objectContaining({
            type: 'mention',
            value: actor2.id
          })
        )
        expect(mentionTags).not.toContainEqual(
          expect.objectContaining({
            type: 'mention',
            value: ACTOR3_ID
          })
        )
      })
    })
  })
})
