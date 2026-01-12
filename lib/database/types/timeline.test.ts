import { FollowStatus } from '@/lib/models/follow'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Timeline } from '@/lib/services/timelines/types'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { cleanJson } from '@/lib/utils/cleanJson'
import { waitFor } from '@/lib/utils/waitFor'

import {
  TestDatabaseTable,
  databaseBeforeAll,
  getTestDatabaseTable
} from '../testUtils'

describe('TimelineDatabase', () => {
  const table: TestDatabaseTable = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    describe('getTimeline', () => {
      describe('Timeline.MAIN', () => {
        const TEST_ID_MAIN = `https://${TEST_DOMAIN}/users/timeline-main`

        beforeAll(async () => {
          await database.createAccount({
            email: `timeline-main@${TEST_DOMAIN}`,
            username: 'timeline-main',
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: 'privateKey-timeline-main',
            publicKey: 'publicKey-timeline-main'
          })
        })

        it('returns main timeline statuses in order', async () => {
          const sender = 'https://llun.dev/users/timeline-sender'
          await database.createFollow({
            actorId: TEST_ID_MAIN,
            targetActorId: sender,
            status: FollowStatus.enum.Accepted,
            inbox: `${TEST_ID_MAIN}/inbox`,
            sharedInbox: `${TEST_ID_MAIN}/inbox`
          })

          for (let i = 0; i < 50; i++) {
            const statusId = `${sender}/statuses/main-post-${i + 1}`
            const status = await database.createNote({
              id: statusId,
              url: statusId,
              actorId: sender,
              text: `Status ${i + 1}`,
              to: [ACTIVITY_STREAM_PUBLIC],
              cc: [TEST_ID_MAIN]
            })
            await addStatusToTimelines(database, status)
            await waitFor(2)
          }

          const statuses = await database.getTimeline({
            timeline: Timeline.MAIN,
            actorId: TEST_ID_MAIN
          })

          for (const index in statuses) {
            const statusId = `${sender}/statuses/main-post-${50 - parseInt(index, 10)}`
            const expectedStatus = await database.getStatus({ statusId })
            expect(cleanJson(statuses[index])).toEqual(
              cleanJson(expectedStatus)
            )
          }
        }, 15000)
      })

      describe('Timeline.MAIN filters', () => {
        const TEST_ID_FILTER = `https://${TEST_DOMAIN}/users/timeline-filter`
        const TEST_ID_OWNER = `https://${TEST_DOMAIN}/users/timeline-owner`

        beforeAll(async () => {
          await database.createAccount({
            email: `timeline-filter@${TEST_DOMAIN}`,
            username: 'timeline-filter',
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: 'privateKey-timeline-filter',
            publicKey: 'publicKey-timeline-filter'
          })
          await database.createAccount({
            email: `timeline-owner@${TEST_DOMAIN}`,
            username: 'timeline-owner',
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: 'privateKey-timeline-owner',
            publicKey: 'publicKey-timeline-owner'
          })
        })

        it('filters out other people replies from timeline', async () => {
          const otherServerUser1 = 'https://other.server/u/user1'
          const otherServerUser1Status = (i: number) =>
            `${otherServerUser1}/s/filter-${i}`
          const otherServerUser2 = 'https://other.mars/u/test2'
          const otherServerUser2Status = (i: number) =>
            `${otherServerUser2}/s/filter-${i}`

          const mainStatusForReplyId = `${TEST_ID_OWNER}/statuses/post-for-reply-filter`
          const mainStatusForReply = await database.createNote({
            id: mainStatusForReplyId,
            url: mainStatusForReplyId,
            actorId: TEST_ID_OWNER,
            text: 'This is status for reply',
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: []
          })
          await addStatusToTimelines(database, mainStatusForReply)

          await database.createFollow({
            actorId: TEST_ID_FILTER,
            targetActorId: otherServerUser1,
            status: FollowStatus.enum.Accepted,
            inbox: `${otherServerUser1}/inbox`,
            sharedInbox: `${otherServerUser1}/inbox`
          })
          await database.createFollow({
            actorId: TEST_ID_FILTER,
            targetActorId: otherServerUser2,
            status: FollowStatus.enum.Accepted,
            inbox: `${otherServerUser2}/inbox`,
            sharedInbox: 'https://other.mars/shared/inbox'
          })

          for (let i = 1; i <= 20; i++) {
            const statusId = `${TEST_ID_FILTER}/statuses/filter-post-${i}`
            const note = await database.createNote({
              id: statusId,
              url: statusId,
              actorId: TEST_ID_FILTER,
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
              const replyNote = await database.createNote({
                id: `${otherServerUser2}/s/filter-reply-${i}`,
                url: `${otherServerUser2}/s/filter-reply-${i}`,
                actorId: otherServerUser2,
                text: `Other server user2 status ${i} reply`,
                to: [ACTIVITY_STREAM_PUBLIC, otherServerUser1],
                cc: [`${otherServerUser2}/followers`],
                reply: otherServerUser1Status(11)
              })
              await addStatusToTimelines(database, replyNote)
            }

            await new Promise((resolve) => setTimeout(resolve, 1))
          }

          expect(
            await database.getActorStatusesCount({ actorId: TEST_ID_FILTER })
          ).toEqual(20)

          const statuses = await database.getTimeline({
            timeline: Timeline.MAIN,
            actorId: TEST_ID_FILTER
          })

          const otherServerReply = await database.getStatus({
            statusId: `${otherServerUser2}/s/filter-reply-19`
          })

          expect(statuses).not.toEqual(
            expect.arrayContaining([
              cleanJson(mainStatusForReply),
              cleanJson(otherServerReply)
            ])
          )
        })
      })

      describe('Timeline.LOCAL_PUBLIC', () => {
        const TEST_ID_PUBLIC = `https://${TEST_DOMAIN}/users/timeline-public`
        const TEST_ID_RECEIVER = `https://${TEST_DOMAIN}/users/timeline-receiver`

        beforeAll(async () => {
          await database.createActor({
            actorId: TEST_ID_PUBLIC,
            username: 'timeline-public',
            domain: TEST_DOMAIN,
            publicKey: 'publicKey-timeline-public',
            privateKey: 'privateKey-timeline-public',
            inboxUrl: `${TEST_ID_PUBLIC}/inbox`,
            sharedInboxUrl: `${TEST_ID_PUBLIC}/inbox`,
            followersUrl: `${TEST_ID_PUBLIC}/followers`,
            createdAt: Date.now()
          })
          await database.createActor({
            actorId: TEST_ID_RECEIVER,
            username: 'timeline-receiver',
            domain: TEST_DOMAIN,
            publicKey: 'publicKey-timeline-receiver',
            privateKey: 'privateKey-timeline-receiver',
            inboxUrl: `${TEST_ID_RECEIVER}/inbox`,
            sharedInboxUrl: `${TEST_ID_RECEIVER}/inbox`,
            followersUrl: `${TEST_ID_RECEIVER}/followers`,
            createdAt: Date.now()
          })

          await database.createNote({
            actorId: TEST_ID_PUBLIC,
            cc: [],
            to: [ACTIVITY_STREAM_PUBLIC],
            id: `${TEST_ID_PUBLIC}/statuses/public-1`,
            text: 'This is public status',
            url: `${TEST_ID_PUBLIC}/statuses/public-1`,
            reply: '',
            createdAt: Date.now()
          })
          await database.createNote({
            actorId: TEST_ID_PUBLIC,
            cc: [ACTIVITY_STREAM_PUBLIC, `${TEST_ID_PUBLIC}/followers`],
            to: [],
            id: `${TEST_ID_PUBLIC}/statuses/public-2`,
            text: 'This is protected status',
            url: `${TEST_ID_PUBLIC}/statuses/public-2`,
            reply: '',
            createdAt: Date.now()
          })
          await database.createNote({
            actorId: TEST_ID_PUBLIC,
            cc: [TEST_ID_RECEIVER],
            to: [],
            id: `${TEST_ID_PUBLIC}/statuses/public-3`,
            text: 'This is direct status',
            url: `${TEST_ID_PUBLIC}/statuses/public-3`,
            reply: '',
            createdAt: Date.now()
          })
        }, 10000)

        afterAll(async () => {
          await database.deleteStatus({
            statusId: `${TEST_ID_PUBLIC}/statuses/public-1`
          })
          await database.deleteActor({ actorId: TEST_ID_PUBLIC })
          await database.deleteActor({ actorId: TEST_ID_RECEIVER })
        })

        it('returns all public posts from local actors', async () => {
          const statuses = await database.getTimeline({
            timeline: Timeline.LOCAL_PUBLIC
          })

          for (const status of statuses) {
            expect(status.actorId).toContain(TEST_DOMAIN)
          }
        }, 10000)
      })
    })
  })
})
