import { DateInterval, generateRandomToken } from '@jmondi/oauth2-server'
import { CollectionWithItems } from '@llun/activities.schema'

import { DEFAULT_OAUTH_TOKEN_LENGTH } from '@/lib/constants'
import {
  TestDatabaseTable,
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Scope } from '@/lib/database/types/oauth'
import { Account } from '@/lib/models/account'
import { Actor, getActorProfile } from '@/lib/models/actor'
import { FollowStatus } from '@/lib/models/follow'
import { AuthCode } from '@/lib/models/oauth2/authCode'
import { Client } from '@/lib/models/oauth2/client'
import { Token } from '@/lib/models/oauth2/token'
import {
  Status,
  StatusNote,
  StatusType,
  toActivityPubObject
} from '@/lib/models/status'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Timeline } from '@/lib/services/timelines/types'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { cleanJson } from '@/lib/utils/cleanJson'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'
import { waitFor } from '@/lib/utils/waitFor'

const TEST_PASSWORD_HASH = 'password_hash'

// For testing existing user
const TEST_EMAIL = `user@${TEST_DOMAIN}`
const TEST_USERNAME = 'user'
const TEST_ID = `https://${TEST_DOMAIN}/users/user`

// Get statuses test user
const TEST_ID5 = `https://${TEST_DOMAIN}/users/user5`

// Get Actor statuses test user
const TEST_ID6 = `https://${TEST_DOMAIN}/users/user6`

// Actor statuses with replies test user
const TEST_ID7 = `https://${TEST_DOMAIN}/users/user7`

// Statuses with replies test user
const TEST_ID8 = `https://${TEST_DOMAIN}/users/user8`

// Status with reply list
const TEST_ID9 = `https://${TEST_DOMAIN}/users/user9`

// Status with boost
const TEST_ID11 = `https://${TEST_DOMAIN}/users/user11`

// Likes
const TEST_ID12 = `https://${TEST_DOMAIN}/users/user12`

// Local public timeline
const TEST_ID13 = `https://${TEST_DOMAIN}/users/user13`
const TEST_USERNAME13 = 'user13'

// Actor boosted test id 11 status
const TEST_ID14 = `https://${TEST_DOMAIN}/users/user14`

// Actor who follows Actor14 and see boost
const TEST_ID15 = `https://${TEST_DOMAIN}/users/user15`

describe('Database', () => {
  const table: TestDatabaseTable = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await database.createAccount({
        email: TEST_EMAIL,
        username: TEST_USERNAME,
        passwordHash: TEST_PASSWORD_HASH,
        domain: TEST_DOMAIN,
        privateKey: 'privateKey1',
        publicKey: 'publicKey1'
      })

      const idWithAccounts = [3, 4, 5, 6, 7, 8, 11, 12, 14, 15]
      await Promise.all(
        idWithAccounts.map((id) =>
          database.createAccount({
            email: `user${id}@llun.dev`,
            username: `user${id}`,
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: `privateKey${id}`,
            publicKey: `publicKey${id}`
          })
        )
      )

      await Promise.all([
        database.createClient({
          name: 'application1',
          redirectUris: ['https://application1.llun.dev/oauth/redirect'],
          scopes: [Scope.enum.read],
          secret: 'secret'
        }),
        database.createClient({
          name: 'application2',
          redirectUris: ['https://application2.llun.dev/oauth/redirect'],
          scopes: [Scope.enum.read, Scope.enum.write],
          secret: 'secret'
        })
      ])
    })

    describe('statuses', () => {
      it('creates a new note', async () => {
        const postId = 'post-1'
        const id = `${TEST_ID}/statuses/${postId}`

        const status = await database.createNote({
          id,
          url: id,
          actorId: TEST_ID,
          text: 'Test Status',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })

        const actor = (await database.getActorFromId({ id: TEST_ID })) as Actor
        expect(status).toEqual({
          id,
          url: id,
          actorId: actor.id,
          actor: getActorProfile(actor),
          type: StatusType.enum.Note,
          text: 'Test Status',
          summary: '',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          edits: [],
          attachments: [],
          totalLikes: 0,
          isActorLiked: false,
          actorAnnounceStatusId: null,
          isLocalActor: true,
          tags: [],
          reply: '',
          replies: [],
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber()
        })
        expect(
          await database.getActorStatusesCount({ actorId: TEST_ID })
        ).toEqual(1)
      })

      it('returns attachments with status', async () => {
        const postId = 'post-2'
        const id = `${TEST_ID}/statuses/${postId}`

        await database.createNote({
          id,
          url: id,
          actorId: TEST_ID,

          text: 'Test Status',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        const attachment = await database.createAttachment({
          actorId: TEST_ID,
          statusId: id,
          mediaType: 'image/png',
          url: 'https://via.placeholder.com/150',
          width: 150,
          height: 150
        })

        const persistedStatus = (await database.getStatus({
          statusId: id
        })) as StatusNote
        expect(persistedStatus.attachments).toHaveLength(1)
        expect(persistedStatus.attachments[0]).toMatchObject(attachment)
      })

      it('returns tags with status', async () => {
        const postId = 'post-3'
        const id = `${TEST_ID}/statuses/${postId}`
        await database.createNote({
          id,
          url: id,
          actorId: TEST_ID,

          text: `@<a href="https://${TEST_DOMAIN}/@test2">test2</a> Test mentions`,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        const tag = await database.createTag({
          statusId: id,
          name: `@test2@${TEST_DOMAIN}`,
          value: `https://${TEST_DOMAIN}/@test2`,
          type: 'mention'
        })
        const persistedStatus = (await database.getStatus({
          statusId: id
        })) as StatusNote
        expect(persistedStatus.tags).toHaveLength(1)
        expect(persistedStatus.tags[0]).toMatchObject(tag)
      })

      it('returns main timeline statuses', async () => {
        const sender = 'https://llun.dev/users/null'
        await database.createFollow({
          actorId: TEST_ID5,
          targetActorId: sender,
          status: FollowStatus.enum.Accepted,
          inbox: `${TEST_ID5}/inbox`,
          sharedInbox: `${TEST_ID5}/inbox`
        })
        for (let i = 0; i < 50; i++) {
          const statusId = `https://llun.dev/users/null/statuses/post-${i + 1}`
          const status = await database.createNote({
            id: statusId,
            url: statusId,
            actorId: sender,

            text: `Status ${i + 1}`,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [TEST_ID5]
          })
          await addStatusToTimelines(database, status)
          // Making sure the timeline is in order.
          await waitFor(2)
        }
        const statuses = await database.getTimeline({
          timeline: Timeline.MAIN,
          actorId: TEST_ID5
        })
        for (const index in statuses) {
          const statusId = `https://llun.dev/users/null/statuses/post-${50 - parseInt(index, 10)}`
          const expectedStatus = await database.getStatus({ statusId })
          expect(cleanJson(statuses[index])).toEqual(cleanJson(expectedStatus))
        }
      }, 10000)

      it('returns all statuses without other people reply', async () => {
        const otherServerUser1 = 'https://other.server/u/user1'
        const otherServerUser1Status = (i: number) =>
          `${otherServerUser1}/s/${i}`
        const otherServerUser2 = 'https://other.mars/u/test2'
        const otherServerUser2Status = (i: number) =>
          `${otherServerUser2}/s/${i}`

        // Mock status for reply
        const mainStatusForReplyId = `${TEST_ID}/statuses/post-for-reply2`
        const mainStatusForReply = await database.createNote({
          id: mainStatusForReplyId,
          url: mainStatusForReplyId,
          actorId: TEST_ID,

          text: 'This is status for reply',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        await addStatusToTimelines(database, mainStatusForReply)

        await database.createFollow({
          actorId: TEST_ID8,
          targetActorId: 'https://other.server/u/user1',
          status: FollowStatus.enum.Accepted,
          inbox: 'https://other.server/u/user1/inbox',
          sharedInbox: 'https://other.server/u/user1/inbox'
        })
        await database.createFollow({
          actorId: TEST_ID8,
          targetActorId: 'https://other.mars/u/test2',
          status: FollowStatus.enum.Accepted,
          inbox: 'https://other.mars/u/test2/inbox',
          sharedInbox: 'https://other.mars/shared/inbox'
        })

        for (let i = 1; i <= 20; i++) {
          const statusId = `${TEST_ID8}/statuses/post-${i}`
          const note = await database.createNote({
            id: statusId,
            url: statusId,
            actorId: TEST_ID8,
            ...(i % 3 === 0 ? { reply: mainStatusForReplyId } : undefined),

            text: `Status ${i}`,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: []
          })
          await addStatusToTimelines(database, note)

          if (i % 11 === 0) {
            const note = await database.createNote({
              id: otherServerUser1Status(i),
              url: otherServerUser1Status(i),
              actorId: otherServerUser1,

              text: `Other server user1 status ${i}`,
              to: [ACTIVITY_STREAM_PUBLIC],
              cc: [`${otherServerUser1}/followers`]
            })
            await addStatusToTimelines(database, note)
          }

          if (i % 17 === 0) {
            const note = await database.createNote({
              id: otherServerUser2Status(i),
              url: otherServerUser2Status(i),
              actorId: otherServerUser2,

              text: `Other server user2 status ${i}`,
              to: [ACTIVITY_STREAM_PUBLIC],
              cc: [`${otherServerUser2}/followers`]
            })
            await addStatusToTimelines(database, note)
          }

          if (i % 19 === 0) {
            const note = await database.createNote({
              id: otherServerUser2Status(i),
              url: otherServerUser2Status(i),
              actorId: otherServerUser2,

              text: `Other server user2 status ${i} reply`,
              to: [ACTIVITY_STREAM_PUBLIC, otherServerUser1],
              cc: [`${otherServerUser2}/followers`],
              reply: otherServerUser1Status(11)
            })
            await addStatusToTimelines(database, note)
          }

          await new Promise((resolve) => setTimeout(resolve, 1))
        }
        expect(
          await database.getActorStatusesCount({ actorId: TEST_ID8 })
        ).toEqual(20)
        const statuses = await database.getTimeline({
          timeline: Timeline.MAIN,
          actorId: TEST_ID8
        })

        const otherServerStatus2 = await database.getStatus({
          statusId: otherServerUser2Status(19)
        })
        expect(statuses).not.toContainValues([
          cleanJson(mainStatusForReply),
          cleanJson(otherServerStatus2)
        ])
      })

      it('returns actor statuses', async () => {
        for (let i = 1; i <= 3; i++) {
          const statusId = `${TEST_ID6}/statuses/post-${i}`
          await database.createNote({
            id: statusId,
            url: statusId,
            actorId: TEST_ID6,

            text: `Status ${i}`,
            to: [ACTIVITY_STREAM_PUBLIC, TEST_ID6],
            cc: []
          })
          await new Promise((resolve) => setTimeout(resolve, 1))
        }
        expect(
          await database.getActorStatusesCount({ actorId: TEST_ID6 })
        ).toEqual(3)

        const statuses = await database.getActorStatuses({ actorId: TEST_ID6 })
        for (let i = 0; i < statuses.length; i++) {
          const status = await database.getStatus({
            statusId: `${TEST_ID6}/statuses/post-${3 - i}`
          })
          expect(statuses[i]).toEqual(status)
        }

        await database.deleteStatus({ statusId: `${TEST_ID6}/statuses/post-2` })
        expect(
          await database.getActorStatusesCount({ actorId: TEST_ID6 })
        ).toEqual(2)

        const statusesAfterDelete = await database.getActorStatuses({
          actorId: TEST_ID6
        })
        expect(statusesAfterDelete.length).toEqual(2)
        expect(statusesAfterDelete[0]).toEqual(
          await database.getStatus({ statusId: `${TEST_ID6}/statuses/post-3` })
        )
        expect(statusesAfterDelete[1]).toEqual(
          await database.getStatus({ statusId: `${TEST_ID6}/statuses/post-1` })
        )
      })

      it('returns actor statuses with replies', async () => {
        // Mock status for reply
        const mainStatusForReplyId = `${TEST_ID}/statuses/post-for-reply`
        await database.createNote({
          id: mainStatusForReplyId,
          url: mainStatusForReplyId,
          actorId: TEST_ID,

          text: 'This is status for reply',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })

        for (let i = 1; i <= 20; i++) {
          const statusId = `${TEST_ID7}/statuses/post-${i}`
          await database.createNote({
            id: statusId,
            url: statusId,
            actorId: TEST_ID7,
            ...(i % 3 === 0 ? { reply: mainStatusForReplyId } : undefined),

            text: `Status ${i}`,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: []
          })
          await new Promise((resolve) => setTimeout(resolve, 1))
        }
        expect(
          await database.getActorStatusesCount({ actorId: TEST_ID7 })
        ).toEqual(20)
        const statuses = await database.getActorStatuses({
          actorId: TEST_ID7
        })
        expect(statuses.length).toEqual(20)
      })

      it('returns status with replies', async () => {
        const statusWithRepliesId = `${TEST_ID9}/s/post-with-replies`
        await database.createNote({
          id: statusWithRepliesId,
          url: statusWithRepliesId,
          actorId: TEST_ID9,

          text: 'This is status for reply',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })

        const reply1ActorId = 'https://someone.else/u/user1'
        const reply1Id = `${reply1ActorId}/s/post-1`
        const reply1 = await database.createNote({
          id: reply1Id,
          url: reply1Id,
          actorId: reply1ActorId,
          reply: statusWithRepliesId,

          text: '@test9 This is first reply',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [TEST_ID9]
        })

        const reply2ActorId = 'https://someone.else/u/user2'
        const reply2Id = `${reply2ActorId}/s/post-1`
        const reply2 = await database.createNote({
          id: reply2Id,
          url: reply2Id,
          actorId: reply2ActorId,
          reply: statusWithRepliesId,

          text: '@test9 This is second reply',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [TEST_ID9]
        })

        const status = (await database.getStatus({
          statusId: statusWithRepliesId,
          withReplies: true
        })) as StatusNote
        expect(status.replies).toHaveLength(2)
        expect(status.replies).toContainAllValues([reply1, reply2])

        const note = toActivityPubObject(status)
        const replies = note.replies as CollectionWithItems
        expect(replies.totalItems).toEqual(2)
        expect(replies.items).toContainAllValues([
          toActivityPubObject(
            (await database.getStatus({ statusId: reply1Id })) as Status
          ),
          toActivityPubObject(
            (await database.getStatus({ statusId: reply2Id })) as Status
          )
        ])
      })

      it('returns status with boost status id', async () => {
        await database.createFollow({
          actorId: TEST_ID14,
          targetActorId: TEST_ID11,
          status: FollowStatus.enum.Accepted,
          inbox: `${TEST_ID14}/inbox`,
          sharedInbox: `${TEST_ID14}/inbox`
        })
        await database.createFollow({
          actorId: TEST_ID15,
          targetActorId: TEST_ID14,
          status: FollowStatus.enum.Accepted,
          inbox: `${TEST_ID15}/inbox`,
          sharedInbox: `${TEST_ID15}/inbox`
        })

        const firstPostId = `${TEST_ID11}/posts/1`
        const note = await database.createNote({
          id: firstPostId,
          url: firstPostId,
          actorId: TEST_ID11,

          text: 'This is status for boost',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${TEST_ID11}/followers`]
        })
        await addStatusToTimelines(database, note)
        const secondPostId = `${TEST_ID14}/posts/2`
        const announce = await database.createAnnounce({
          id: secondPostId,
          actorId: TEST_ID14,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${TEST_ID14}/followers`],
          originalStatusId: firstPostId
        })
        if (!announce) {
          fail('Announce must not be undefined')
        }
        await addStatusToTimelines(database, announce)

        const test14Statuses = await database.getTimeline({
          timeline: Timeline.MAIN,
          actorId: TEST_ID14
        })
        const statusData = test14Statuses.shift() as StatusNote
        expect(statusData.actorAnnounceStatusId).not.toBeNull()

        const test15Statuses = await database.getTimeline({
          timeline: Timeline.MAIN,
          actorId: TEST_ID15
        })
        const announceStatus = test15Statuses.shift()
        if (announceStatus?.type !== StatusType.enum.Announce) {
          fail('Status must be announce')
        }

        const originalStatus = announceStatus.originalStatus
        expect(originalStatus.id).toEqual(note.id)
      }, 15000)
    })

    describe('likes', () => {
      it('returns status with likes count', async () => {
        const statusId = `${TEST_ID12}/posts/1`
        const status = (await database.createNote({
          id: statusId,
          url: statusId,
          actorId: TEST_ID12,

          text: 'Status without likes',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })) as StatusNote
        expect(status.totalLikes).toEqual(0)

        await database.createLike({ actorId: TEST_ID, statusId })
        const statusAfterLiked = (await database.getStatus({
          statusId
        })) as StatusNote
        expect(statusAfterLiked.totalLikes).toEqual(1)
        expect(await database.getLikeCount({ statusId })).toEqual(1)

        await database.deleteLike({ actorId: TEST_ID, statusId })
        const statusAfterUnliked = (await database.getStatus({
          statusId
        })) as StatusNote
        expect(statusAfterUnliked.totalLikes).toEqual(0)
        expect(await database.getLikeCount({ statusId })).toEqual(0)
      })

      it('does not create like if the status is not exists', async () => {
        const nonExistsStatusId = `${TEST_ID12}/posts/non-exists`
        await database.createLike({
          actorId: TEST_ID,
          statusId: nonExistsStatusId
        })
        expect(
          await database.getLikeCount({ statusId: nonExistsStatusId })
        ).toEqual(0)
      })
    })

    describe('timelines', () => {
      // TODO: Create timeline model that can has different query
      describe('public', () => {
        beforeAll(async () => {
          await database.createActor({
            actorId: TEST_ID13,
            username: TEST_USERNAME13,
            domain: TEST_DOMAIN,
            publicKey: 'publicKey',
            privateKey: 'privateKey',
            inboxUrl: `${TEST_ID13}/inbox`,
            sharedInboxUrl: `${TEST_ID13}/inbox`,
            followersUrl: `${TEST_ID13}/followers`,
            createdAt: Date.now()
          })
          await database.createNote({
            actorId: TEST_ID13,
            cc: [],
            to: [ACTIVITY_STREAM_PUBLIC],
            id: `${TEST_ID13}/statuses/1`,
            text: 'This is public status',
            url: `${TEST_ID13}/statuses/1`,
            reply: '',
            createdAt: Date.now()
          })
          await database.createNote({
            actorId: TEST_ID13,
            cc: [ACTIVITY_STREAM_PUBLIC, `${TEST_ID13}/followers`],
            to: [],
            id: `${TEST_ID13}/statuses/2`,
            text: 'This is protected status',
            url: `${TEST_ID13}/statuses/2`,
            reply: '',
            createdAt: Date.now()
          })
          await database.createNote({
            actorId: TEST_ID13,
            cc: [TEST_ID12],
            to: [],
            id: `${TEST_ID13}/statuses/3`,
            text: 'This is direct status',
            url: `${TEST_ID13}/statuses/3`,
            reply: '',
            createdAt: Date.now()
          })
        }, 10000)

        afterAll(async () => {
          await database.deleteStatus({ statusId: `${TEST_ID13}/statuses/1` })
          await database.deleteActor({ actorId: TEST_ID13 })
        })

        it('returns all public posts from all local actors in instances', async () => {
          const statuses = await database.getTimeline({
            timeline: Timeline.LOCAL_PUBLIC
          })
          for (const status of statuses) {
            expect(status.actorId).toContain(TEST_DOMAIN)
          }
        }, 10000)
      })
    })

    describe('clients', () => {
      it('adds client record and returns client model', async () => {
        const client = await database.createClient({
          name: 'application3',
          redirectUris: ['https://application3.llun.dev/oauth/redirect'],
          scopes: [Scope.enum.read, Scope.enum.write],
          secret: 'some random secret'
        })
        expect(client).toEqual({
          id: expect.toBeString(),
          name: 'application3',
          secret: 'some random secret',
          scopes: [{ name: 'read' }, { name: 'write' }],
          redirectUris: ['https://application3.llun.dev/oauth/redirect'],
          allowedGrants: [
            'client_credentials',
            'authorization_code',
            'refresh_token'
          ],
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber()
        })
      })

      it('returns null when failed validation', async () => {
        await expect(
          database.createClient({
            name: 'application2',
            redirectUris: ['somerandomstring'],
            scopes: [Scope.enum.read, Scope.enum.write],
            secret: 'some random secret'
          })
        ).rejects.toThrow()
      })

      it('returns null when application name already exists', async () => {
        await expect(
          database.createClient({
            name: 'application1',
            redirectUris: ['https://application1.llun.dev/oauth/redirect'],
            scopes: [Scope.enum.read, Scope.enum.write],
            secret: 'some random secret'
          })
        ).rejects.toThrow('Client application1 is already exists')
      })

      it('returns existing client in storage', async () => {
        const application = await database.getClientFromName({
          name: 'application1'
        })
        const withIdApplication = await database.getClientFromId({
          clientId: (application as Client).id
        })

        expect(application).toEqual({
          id: expect.toBeString(),
          name: 'application1',
          secret: 'secret',
          scopes: [{ name: 'read' }],
          redirectUris: ['https://application1.llun.dev/oauth/redirect'],
          allowedGrants: [
            'client_credentials',
            'authorization_code',
            'refresh_token'
          ],
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber()
        })
        expect(withIdApplication).toEqual({
          id: expect.toBeString(),
          name: 'application1',
          secret: 'secret',
          scopes: [{ name: 'read' }],
          redirectUris: ['https://application1.llun.dev/oauth/redirect'],
          allowedGrants: [
            'client_credentials',
            'authorization_code',
            'refresh_token'
          ],
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber()
        })
      })

      it('updates client and returns the updated client', async () => {
        const existingClient = await database.getClientFromName({
          name: 'application2'
        })
        if (!existingClient) fail('Client must exists')

        const client = await database.updateClient({
          id: existingClient.id,
          name: 'application2',
          redirectUris: ['https://application2.llun.dev/oauth/redirect'],
          scopes: [Scope.enum.read],
          secret: 'secret'
        })
        const updatedExistingClient = await database.getClientFromName({
          name: 'application2'
        })

        if (!client) fail('Client must exists')
        expect(client).toEqual(updatedExistingClient)
        expect(client.scopes).toEqual([{ name: 'read' }])
      })

      describe('tokens', () => {
        let token: Token | null
        let actor: Actor | undefined
        let client: Client | null

        beforeAll(async () => {
          ;[actor, client] = await Promise.all([
            database.getActorFromEmail({
              email: TEST_EMAIL
            }),
            database.getClientFromName({ name: 'application1' })
          ])

          token = await database.createAccessToken({
            accessToken: generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH),
            accessTokenExpiresAt: new DateInterval('30d')
              .getEndDate()
              .getTime(),
            accountId: (actor?.account as Account).id,
            actorId: actor?.id as string,
            clientId: client?.id as string,
            scopes: [Scope.enum.read]
          })
        })

        it('adds token to the repository', async () => {
          const token = await database.createAccessToken({
            accessToken: generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH),
            accessTokenExpiresAt: new DateInterval('30d')
              .getEndDate()
              .getTime(),
            accountId: (actor?.account as Account).id,
            actorId: actor?.id as string,
            clientId: client?.id as string,
            scopes: [Scope.enum.read]
          })
          expect(token?.client).toEqual(client)
          expect(token?.user?.actor).toEqual(actor)
          expect(token?.user?.id).toEqual(actor?.id)
        })

        it('adds refresh token to access token', async () => {
          const refreshToken = generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH)
          const refreshTokenExpiresAt = new DateInterval('2d')
            .getEndDate()
            .getTime()

          await database.updateRefreshToken({
            accessToken: token?.accessToken as string,
            refreshToken,
            refreshTokenExpiresAt
          })

          token = await database.getAccessToken({
            accessToken: token?.accessToken as string
          })
          expect(token?.refreshToken).toEqual(refreshToken)
          expect(token?.refreshTokenExpiresAt?.getTime()).toEqual(
            refreshTokenExpiresAt
          )

          const tokenFromRefreshToken =
            await database.getAccessTokenByRefreshToken({
              refreshToken
            })
          expect(tokenFromRefreshToken).toEqual(token)
        })

        it('sets expires at for both accessToken and refreshToken when revoke accessToken', async () => {
          const revokedToken = await database.revokeAccessToken({
            accessToken: token?.accessToken as string
          })
          expect(revokedToken?.accessTokenExpiresAt).toBeDefined()
          expect(revokedToken?.refreshTokenExpiresAt).toBeDefined()
          expect(revokedToken?.accessTokenExpiresAt.getTime()).toEqual(
            revokedToken?.refreshTokenExpiresAt?.getTime()
          )
        })
      })

      describe('authCode', () => {
        let actor: Actor | undefined
        let client: Client | null
        let code: AuthCode | null

        beforeAll(async () => {
          ;[actor, client] = await Promise.all([
            database.getActorFromEmail({
              email: TEST_EMAIL
            }),
            database.getClientFromName({ name: 'application1' })
          ])

          code = await database.createAuthCode({
            code: generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH),
            redirectUri: 'https://application1.llun.dev/oauth/redirect',
            codeChallenge: 'challenge',
            codeChallengeMethod: 'plain',
            clientId: client?.id as string,
            accountId: actor?.account?.id as string,
            actorId: actor?.id as string,
            scopes: [Scope.enum.read],
            expiresAt: new DateInterval('50m').getEndDate().getTime()
          })
        })

        it('adds authCode to the repository', async () => {
          const code = await database.createAuthCode({
            code: generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH),
            redirectUri: null,
            codeChallenge: null,
            codeChallengeMethod: 'S256',
            clientId: client?.id as string,
            accountId: actor?.account?.id as string,
            actorId: actor?.id as string,
            scopes: [Scope.enum.read],
            expiresAt: new DateInterval('50m').getEndDate().getTime()
          })

          expect(code?.client).toEqual(client)
          expect(code?.user?.actor).toEqual(actor)
          expect(code?.user?.id).toEqual(actor?.id)
        })

        it('returns authCode from storage', async () => {
          const codeFromStorage = await database.getAuthCode({
            code: code?.code as string
          })
          expect(codeFromStorage).toEqual(code)
        })

        it('sets expires at when revoking authCode', async () => {
          const revokedAuthCode = await database.revokeAuthCode({
            code: code?.code as string
          })
          expect(revokedAuthCode?.expiresAt).toBeDefined()
        })
      })
    })
  })
})
