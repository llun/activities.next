import { enableFetchMocks } from 'jest-fetch-mock'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { useCreateNoteFixtures } from './createNote.testUtils'

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
    describe('visibility support', () => {
      // Replying requires reading the parent, so the tests that reply to one
      // of actor2's followers-only posts need actor1 to be an accepted
      // follower of actor2 (the seed does not make it one).
      const followActor2 = async () => {
        const existing = await database.getAcceptedOrRequestedFollow({
          actorId: actor1.id,
          targetActorId: actor2.id
        })
        if (existing) return
        await database.createFollow({
          actorId: actor1.id,
          targetActorId: actor2.id,
          inbox: `${actor1.id}/inbox`,
          sharedInbox: `${actor1.id}/inbox`,
          status: FollowStatus.enum.Accepted
        })
      }

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

        expect(status.to).toEqual([ACTOR2_ID])
        expect(status.cc).toEqual([])
      })

      describe('direct reply to a non-direct parent', () => {
        let replyStatus: StatusNote

        beforeEach(async () => {
          await clearSettledNotificationAlerts()
          const parentStatus = (await createNoteFromUserInput({
            text: 'Public parent from actor2',
            currentActor: actor2,
            database
          })) as StatusNote

          replyStatus = (await createNoteFromUserInput({
            text: '@test3@llun.test private side note',
            currentActor: actor1,
            replyNoteId: parentStatus.id,
            visibility: 'direct',
            database
          })) as StatusNote
          await new Promise((resolve) => setTimeout(resolve, 0))
        })

        it('stores only the explicit direct recipient', () => {
          expect(replyStatus.to).toEqual([ACTOR3_ID])
          expect(replyStatus.cc).toEqual([])
        })

        it('only notifies explicit direct recipients, not the parent author', async () => {
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
        await followActor2()
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

      it('rejects a direct note without an explicit recipient', async () => {
        const status = await createNoteFromUserInput({
          text: 'Direct message without mention',
          currentActor: actor1,
          visibility: 'direct',
          database
        })

        expect(status).toBeNull()
      })

      it('rejects a direct reply to a non-direct status without an explicit recipient', async () => {
        const parentStatus = await database.createNote({
          id: `${actor1.id}/statuses/public-parent-direct-no-recipient`,
          url: `${actor1.id}/statuses/public-parent-direct-no-recipient`,
          actorId: 'https://remote.test/actors/public-parent',
          text: 'Public parent',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${actor1.id}/followers`]
        })

        const status = await createNoteFromUserInput({
          text: 'quiet direct reply',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          visibility: 'direct',
          database
        })

        expect(status).toBeNull()
      })

      it('does not inherit non-direct parent audiences for explicit direct replies', async () => {
        const parentStatus = await database.createNote({
          id: `${actor1.id}/statuses/public-parent-direct-audience`,
          url: `${actor1.id}/statuses/public-parent-direct-audience`,
          actorId: 'https://remote.test/actors/public-parent-audience',
          text: 'Public parent with audiences',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [
            `${actor1.id}/followers`,
            'https://remote.test/actors/parent-mention'
          ]
        })

        const status = (await createNoteFromUserInput({
          text: '@test2@llun.test direct reply',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          visibility: 'direct',
          database
        })) as StatusNote

        expect(status.to).toEqual([ACTOR2_ID])
        expect(status.cc).toEqual([])
      })

      it('preserves direct reply parent to and cc recipients without repeated mentions', async () => {
        const parentStatus = await database.createNote({
          id: `${actor1.id}/statuses/direct-parent-note-recipients`,
          url: `${actor1.id}/statuses/direct-parent-note-recipients`,
          actorId: 'https://remote.test/actors/sender',
          text: 'Direct parent',
          to: [actor1.id, 'https://remote.test/actors/primary'],
          cc: ['https://remote.test/actors/copied']
        })

        const status = (await createNoteFromUserInput({
          text: 'Reply without mention prefixes',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          database
        })) as StatusNote

        expect(status.to).toEqual(
          expect.arrayContaining([
            actor1.id,
            'https://remote.test/actors/primary',
            'https://remote.test/actors/sender'
          ])
        )
        expect(status.cc).toEqual(['https://remote.test/actors/copied'])
      })

      it('refuses to reply into a direct thread the author cannot read', async () => {
        const parentId = `${ACTOR2_ID}/statuses/unreadable-direct-parent`
        await database.createNote({
          id: parentId,
          url: parentId,
          actorId: ACTOR2_ID,
          text: 'Direct between actor2 and actor3',
          to: [ACTOR3_ID],
          cc: []
        })

        const reply = await createNoteFromUserInput({
          text: 'Injected reply',
          currentActor: actor1,
          replyNoteId: parentId,
          visibility: 'direct',
          database
        })

        // Without the guard this inherits the parent's to/cc and lands in
        // actor2/actor3's private conversation.
        expect(reply).toBeNull()
      })

      it('does not store non-direct parent audiences as mention tags', async () => {
        await followActor2()
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
