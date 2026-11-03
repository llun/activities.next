import { enableFetchMocks } from 'jest-fetch-mock'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { getQueue } from '@/lib/services/queue'
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
    settleNotificationAlerts,
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
          await settleNotificationAlerts()
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
        await settleNotificationAlerts()

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

      it('reaches a direct participant the reply text mentions', async () => {
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
          text: '@test2@llun.test @test3@llun.test Reply to the group thread',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          database
        })) as StatusNote
        await settleNotificationAlerts()

        expect(replyStatus.to).toEqual(
          expect.arrayContaining([actor2.id, ACTOR3_ID])
        )
        expect(replyStatus.to).not.toContain(actor1.id)
        expect(replyStatus.cc).toEqual([])

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

      it('does not reach a direct participant left out of the reply text', async () => {
        await clearSettledNotificationAlerts()
        const parentStatus = await database.createNote({
          id: `${actor2.id}/statuses/direct-group-left-out-parent`,
          url: `${actor2.id}/statuses/direct-group-left-out-parent`,
          actorId: actor2.id,
          text: 'Direct group parent from actor2',
          to: [actor1.id],
          cc: [ACTOR3_ID]
        })

        const replyStatus = (await createNoteFromUserInput({
          text: '@test2@llun.test Just between us',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          database
        })) as StatusNote
        await settleNotificationAlerts()

        expect(replyStatus.to).toEqual([actor2.id])
        expect(replyStatus.cc).toEqual([])
        const leftOutNotifications = await database.getNotifications({
          actorId: ACTOR3_ID,
          limit: 100
        })
        expect(
          leftOutNotifications.filter(
            (notification) => notification.statusId === replyStatus.id
          )
        ).toHaveLength(0)
        const mentionTags = await database.getTags({
          statusId: replyStatus.id
        })
        expect(mentionTags).not.toContainEqual(
          expect.objectContaining({ type: 'mention', value: ACTOR3_ID })
        )
      })

      it('stores the mentioned accounts and the parent author as a direct reply mention tags', async () => {
        const parentStatus = await database.createNote({
          id: `${actor1.id}/statuses/direct-parent-note-mention-tags`,
          url: `${actor1.id}/statuses/direct-parent-note-mention-tags`,
          actorId: 'https://remote.test/actors/direct-sender',
          text: 'Direct parent with multiple recipients',
          to: [actor1.id, ACTOR2_ID],
          cc: [ACTOR3_ID]
        })

        const status = (await createNoteFromUserInput({
          text: '@test2@llun.test Reply naming one participant',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          database
        })) as StatusNote

        const mentionValues = (await database.getTags({ statusId: status.id }))
          .filter((tag) => tag.type === 'mention')
          .map((tag) => tag.value)

        expect(mentionValues.sort()).toEqual(
          [ACTOR2_ID, parentStatus.actorId].sort()
        )
      })

      it('keeps the parent recipients on a self-reply in a direct thread that names nobody', async () => {
        const parentStatus = await database.createNote({
          id: `${actor1.id}/statuses/direct-self-parent`,
          url: `${actor1.id}/statuses/direct-self-parent`,
          actorId: actor1.id,
          text: 'Direct from actor1',
          to: [ACTOR2_ID],
          cc: [ACTOR3_ID]
        })

        const status = (await createNoteFromUserInput({
          text: 'And one more thing',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          database
        })) as StatusNote

        expect(status.to.sort()).toEqual([ACTOR2_ID, ACTOR3_ID].sort())
        expect(status.cc).toEqual([])
        const mentionValues = (await database.getTags({ statusId: status.id }))
          .filter((tag) => tag.type === 'mention')
          .map((tag) => tag.value)
        expect(mentionValues.sort()).toEqual([ACTOR2_ID, ACTOR3_ID].sort())
      })

      it('addresses a self-reply in a direct thread only to the accounts its text mentions', async () => {
        const parentStatus = await database.createNote({
          id: `${actor1.id}/statuses/direct-self-parent-mentions`,
          url: `${actor1.id}/statuses/direct-self-parent-mentions`,
          actorId: actor1.id,
          text: 'Direct from actor1',
          to: [ACTOR2_ID],
          cc: [ACTOR3_ID]
        })

        const status = (await createNoteFromUserInput({
          text: '@test2@llun.test only you',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          database
        })) as StatusNote

        expect(status.to).toEqual([ACTOR2_ID])
        expect(status.cc).toEqual([])
      })

      it('addresses a self-reply in a followers-only thread to the followers, not the author', async () => {
        const parentStatus = (await createNoteFromUserInput({
          text: 'Followers-only from actor1',
          currentActor: actor1,
          visibility: 'private',
          database
        })) as StatusNote

        const status = (await createNoteFromUserInput({
          text: 'Continuing my thread',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          database
        })) as StatusNote

        expect(status.to).toEqual([actor1.followersUrl])
        expect(status.cc).toEqual([])
        expect(
          (await database.getTags({ statusId: status.id })).filter(
            (tag) => tag.type === 'mention'
          )
        ).toEqual([])
      })

      it('does not address or mention the author on a public self-reply', async () => {
        const parentStatus = (await createNoteFromUserInput({
          text: 'Public from actor1',
          currentActor: actor1,
          database
        })) as StatusNote

        const status = (await createNoteFromUserInput({
          text: 'Public follow-up',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          database
        })) as StatusNote

        expect([...status.to].sort()).toEqual(
          [ACTIVITY_STREAM_PUBLIC, actor1.followersUrl].sort()
        )
        expect(status.cc).toEqual([actor1.followersUrl])
        expect([...status.to, ...status.cc]).not.toContain(actor1.id)
        expect(
          (await database.getTags({ statusId: status.id })).filter(
            (tag) => tag.type === 'mention'
          )
        ).toEqual([])
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

      it('addresses a direct reply to the parent author, not the rest of the parent audience', async () => {
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

        expect(status.to).toEqual(['https://remote.test/actors/sender'])
        expect(status.cc).toEqual([])
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

      it('treats a Friendica followers collection on the parent as followers-only', async () => {
        const friendicaAuthorId = 'https://friendica.test/profile/alice'
        const friendicaFollowersUrl = 'https://friendica.test/followers/alice'
        await database.createActor({
          actorId: friendicaAuthorId,
          type: 'Person',
          username: 'alice',
          domain: 'friendica.test',
          followersUrl: friendicaFollowersUrl,
          inboxUrl: `${friendicaAuthorId}/inbox`,
          sharedInboxUrl: 'https://friendica.test/inbox',
          publicKey: 'public',
          createdAt: Date.now()
        })
        const parentStatus = await database.createNote({
          id: 'https://friendica.test/objects/followers-only-parent',
          url: 'https://friendica.test/objects/followers-only-parent',
          actorId: friendicaAuthorId,
          text: 'Followers-only on Friendica',
          to: [friendicaFollowersUrl],
          cc: [actor1.id]
        })

        const status = (await createNoteFromUserInput({
          text: 'Reply to a Friendica followers-only post',
          currentActor: actor1,
          replyNoteId: parentStatus.id,
          database
        })) as StatusNote

        // Followers-only, not direct: the reply goes to our followers and the
        // parent author, never to the parent author's followers collection.
        expect([...status.to].sort()).toEqual(
          [actor1.followersUrl, friendicaAuthorId].sort()
        )
        expect([...status.to, ...status.cc]).not.toContain(
          friendicaFollowersUrl
        )
        expect([...status.to, ...status.cc]).not.toContain(
          ACTIVITY_STREAM_PUBLIC
        )
        const mentionValues = (await database.getTags({ statusId: status.id }))
          .filter((tag) => tag.type === 'mention')
          .map((tag) => tag.value)
        expect(mentionValues).toEqual([friendicaAuthorId])
      })

      it('refuses a reply whose parent no longer exists and sends nothing', async () => {
        const publish = getQueue().publish as ReturnType<typeof vi.fn>
        publish.mockClear()

        const status = await createNoteFromUserInput({
          text: 'Reply to a deleted post',
          currentActor: actor1,
          replyNoteId: `${ACTOR2_ID}/statuses/deleted-parent`,
          database
        })

        expect(status).toBeNull()
        expect(publish).not.toHaveBeenCalled()
        const statuses = await database.getActorStatuses({
          actorId: actor1.id
        })
        expect(
          statuses.find(
            (item) =>
              item.type !== 'Announce' &&
              item.text.includes('Reply to a deleted post')
          )
        ).toBeUndefined()
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
