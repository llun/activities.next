import {
  TestDatabaseTable,
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Timeline } from '@/lib/services/timelines/types'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { cleanJson } from '@/lib/utils/cleanJson'
import { waitFor } from '@/lib/utils/waitFor'

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

        it('does not repeat statuses when paginating with out-of-order insertion', async () => {
          const TEST_ID_PAGINATE = `https://${TEST_DOMAIN}/users/timeline-paginate`
          await database.createAccount({
            email: `timeline-paginate@${TEST_DOMAIN}`,
            username: 'timeline-paginate',
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: 'privateKey-timeline-paginate',
            publicKey: 'publicKey-timeline-paginate'
          })

          const sender = 'https://llun.dev/users/timeline-sender-pagination'
          await database.createFollow({
            actorId: TEST_ID_PAGINATE,
            targetActorId: sender,
            status: FollowStatus.enum.Accepted,
            inbox: `${sender}/inbox`,
            sharedInbox: `${sender}/inbox`
          })

          // Status B is created with a newer timestamp but inserted first into timelines.
          // This simulates a recent status from a followed actor.
          const statusBId = `${sender}/statuses/pagination-b`
          const statusB = await database.createNote({
            id: statusBId,
            url: statusBId,
            actorId: sender,
            text: 'Status B (newer createdAt, inserted first)',
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [TEST_ID_PAGINATE],
            createdAt: 2000
          })
          await addStatusToTimelines(database, statusB)

          // Status A is created with an older timestamp but inserted second into timelines.
          // This simulates a federated status arriving late (high row id, low createdAt).
          const statusAId = `${sender}/statuses/pagination-a`
          const statusA = await database.createNote({
            id: statusAId,
            url: statusAId,
            actorId: sender,
            text: 'Status A (older createdAt, inserted second)',
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [TEST_ID_PAGINATE],
            createdAt: 1000
          })
          await addStatusToTimelines(database, statusA)

          // First page should show B first (newer createdAt), then A
          const firstPage = await database.getTimeline({
            timeline: Timeline.MAIN,
            actorId: TEST_ID_PAGINATE,
            limit: 2
          })

          const firstPageIds = firstPage.map((s) => s.id)
          expect(firstPageIds).toContain(statusBId)
          expect(firstPageIds).toContain(statusAId)
          expect(firstPageIds.indexOf(statusBId)).toBeLessThan(
            firstPageIds.indexOf(statusAId)
          )

          // Load more after A (the last on the first page) should NOT return B again
          const cursor = firstPage[firstPage.length - 1].id
          const secondPage = await database.getTimeline({
            timeline: Timeline.MAIN,
            actorId: TEST_ID_PAGINATE,
            maxStatusId: cursor,
            limit: 10
          })

          const secondPageIds = secondPage.map((s) => s.id)
          expect(secondPageIds).not.toContain(statusBId)
          expect(secondPageIds).not.toContain(statusAId)
        }, 15000)

        it('distinguishes min_id (adjacent page) from since_id (newest slice)', async () => {
          const TEST_ID_CURSOR = `https://${TEST_DOMAIN}/users/timeline-cursor`
          await database.createAccount({
            email: `timeline-cursor@${TEST_DOMAIN}`,
            username: 'timeline-cursor',
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: 'privateKey-timeline-cursor',
            publicKey: 'publicKey-timeline-cursor'
          })

          const sender = 'https://llun.dev/users/timeline-cursor-sender'
          await database.createFollow({
            actorId: TEST_ID_CURSOR,
            targetActorId: sender,
            status: FollowStatus.enum.Accepted,
            inbox: `${sender}/inbox`,
            sharedInbox: `${sender}/inbox`
          })

          // Five posts, oldest → newest by createdAt.
          const ids: string[] = []
          for (let i = 1; i <= 5; i++) {
            const id = `${sender}/statuses/cursor-${i}`
            const status = await database.createNote({
              id,
              url: id,
              actorId: sender,
              text: `cursor post ${i}`,
              to: [ACTIVITY_STREAM_PUBLIC],
              cc: [TEST_ID_CURSOR],
              createdAt: 1000 * i
            })
            await addStatusToTimelines(database, status)
            ids.push(id)
          }
          const [oldest, second, middle, fourth, newest] = ids

          // since_id: the two NEWEST statuses above the cursor.
          const sincePage = await database.getTimeline({
            timeline: Timeline.MAIN,
            actorId: TEST_ID_CURSOR,
            sinceStatusId: oldest,
            limit: 2
          })
          expect(sincePage.map((status) => status.id)).toEqual([newest, fourth])

          // min_id: the two OLDEST statuses above the cursor (the adjacent page),
          // returned newest-first — a different slice than since_id.
          const minPage = await database.getTimeline({
            timeline: Timeline.MAIN,
            actorId: TEST_ID_CURSOR,
            minStatusId: oldest,
            limit: 2
          })
          expect(minPage.map((status) => status.id)).toEqual([middle, second])
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

        it('returns only statuses with attachments when onlyMedia is set', async () => {
          const mediaStatusId = `${TEST_ID_PUBLIC}/statuses/public-media-1`
          await database.createNote({
            actorId: TEST_ID_PUBLIC,
            cc: [],
            to: [ACTIVITY_STREAM_PUBLIC],
            id: mediaStatusId,
            text: 'This is a public status with media',
            url: mediaStatusId,
            reply: '',
            createdAt: Date.now()
          })
          await database.createAttachment({
            actorId: TEST_ID_PUBLIC,
            statusId: mediaStatusId,
            mediaType: 'image/png',
            url: `${mediaStatusId}/image.png`
          })

          const statuses = await database.getTimeline({
            timeline: Timeline.LOCAL_PUBLIC,
            onlyMedia: true
          })

          const ids = statuses.map((status) => status.id)
          expect(ids).toContain(mediaStatusId)
          expect(ids).not.toContain(`${TEST_ID_PUBLIC}/statuses/public-1`)
        })

        it('continues paginating when a public cursor recipient row is gone', async () => {
          const olderStatusId = `${TEST_ID_PUBLIC}/statuses/public-cursor-older`
          const cursorStatusId = `${TEST_ID_PUBLIC}/statuses/public-cursor`

          await database.createNote({
            actorId: TEST_ID_PUBLIC,
            cc: [],
            to: [ACTIVITY_STREAM_PUBLIC],
            id: olderStatusId,
            text: 'Older public cursor fallback status',
            url: olderStatusId,
            reply: ''
          })
          await waitFor(2)
          await database.createNote({
            actorId: TEST_ID_PUBLIC,
            cc: [],
            to: [ACTIVITY_STREAM_PUBLIC],
            id: cursorStatusId,
            text: 'Cursor status that leaves the public timeline',
            url: cursorStatusId,
            reply: ''
          })

          await database.updateNoteVisibility({
            statusId: cursorStatusId,
            to: [`${TEST_ID_PUBLIC}/followers`],
            cc: []
          })

          const statuses = await database.getTimeline({
            timeline: Timeline.LOCAL_PUBLIC,
            maxStatusId: cursorStatusId,
            limit: 10
          })

          expect(statuses.map((status) => status.id)).toContain(olderStatusId)
        }, 10000)

        it('keeps tied public statuses when a public cursor recipient row is gone', async () => {
          const tiedCreatedAt = Date.now()
          const tiedStatusId = `${TEST_ID_PUBLIC}/statuses/public-cursor-tied-a`
          const cursorStatusId = `${TEST_ID_PUBLIC}/statuses/public-cursor-tied-z`

          await database.createNote({
            actorId: TEST_ID_PUBLIC,
            cc: [],
            to: [ACTIVITY_STREAM_PUBLIC],
            id: tiedStatusId,
            text: 'Tied public cursor fallback status',
            url: tiedStatusId,
            reply: '',
            createdAt: tiedCreatedAt
          })
          await database.createNote({
            actorId: TEST_ID_PUBLIC,
            cc: [],
            to: [ACTIVITY_STREAM_PUBLIC],
            id: cursorStatusId,
            text: 'Tied cursor status that leaves the public timeline',
            url: cursorStatusId,
            reply: '',
            createdAt: tiedCreatedAt
          })

          await database.updateNoteVisibility({
            statusId: cursorStatusId,
            to: [`${TEST_ID_PUBLIC}/followers`],
            cc: []
          })

          const statuses = await database.getTimeline({
            timeline: Timeline.LOCAL_PUBLIC,
            maxStatusId: cursorStatusId,
            limit: 10
          })

          expect(statuses.map((status) => status.id)).toContain(tiedStatusId)
        }, 10000)
      })

      describe('exclusive lists', () => {
        const OWNER = `https://${TEST_DOMAIN}/users/excl-owner`
        const OTHER_OWNER = `https://${TEST_DOMAIN}/users/excl-other-owner`
        const EXCL_MEMBER = `https://${TEST_DOMAIN}/users/excl-member`
        const NORMAL_MEMBER = `https://${TEST_DOMAIN}/users/excl-normal`
        const PLAIN = `https://${TEST_DOMAIN}/users/excl-plain`

        const account = (username: string) =>
          database.createAccount({
            email: `${username}@${TEST_DOMAIN}`,
            username,
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: `privateKey-${username}`,
            publicKey: `publicKey-${username}`
          })

        const seed = async (
          authorId: string,
          localId: string,
          timeline: Timeline,
          ownerId = OWNER
        ) => {
          const id = `${authorId}/statuses/${localId}`
          const status = await database.createNote({
            id,
            url: id,
            actorId: authorId,
            text: `exclusive ${localId}`,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: []
          })
          await database.createTimelineStatus({
            actorId: ownerId,
            status,
            timeline
          })
          return id
        }

        beforeAll(async () => {
          await account('excl-owner')
          await account('excl-other-owner')
          await account('excl-member')
          await account('excl-normal')
          await account('excl-plain')

          const exclusiveList = await database.createList({
            actorId: OWNER,
            title: 'Exclusive',
            exclusive: true
          })
          await database.addListAccounts({
            listId: exclusiveList.id,
            actorId: OWNER,
            targetActorIds: [EXCL_MEMBER]
          })
          const normalList = await database.createList({
            actorId: OWNER,
            title: 'Normal',
            exclusive: false
          })
          await database.addListAccounts({
            listId: normalList.id,
            actorId: OWNER,
            targetActorIds: [NORMAL_MEMBER]
          })
        })

        it('hides exclusive-list members from the home timeline', async () => {
          const exclId = await seed(EXCL_MEMBER, 'home-excl', Timeline.MAIN)
          const normalId = await seed(
            NORMAL_MEMBER,
            'home-normal',
            Timeline.MAIN
          )
          const plainId = await seed(PLAIN, 'home-plain', Timeline.MAIN)

          const ids = (
            await database.getTimeline({
              timeline: Timeline.MAIN,
              actorId: OWNER
            })
          ).map((status) => status.id)

          expect(ids).not.toContain(exclId)
          expect(ids).toContain(normalId)
          expect(ids).toContain(plainId)
        })

        it('still shows exclusive-list members in the direct timeline', async () => {
          const directId = await seed(
            EXCL_MEMBER,
            'direct-excl',
            Timeline.DIRECT
          )

          const directIds = (
            await database.getTimeline({
              timeline: Timeline.DIRECT,
              actorId: OWNER
            })
          ).map((status) => status.id)

          expect(directIds).toContain(directId)
        })

        it("does not apply another owner's exclusive list to this viewer", async () => {
          // OTHER_OWNER marks EXCL_MEMBER exclusive on their own list; OWNER, who
          // has no such list for this author, must still see them at home.
          const otherList = await database.createList({
            actorId: OTHER_OWNER,
            title: 'Other exclusive',
            exclusive: true
          })
          await database.addListAccounts({
            listId: otherList.id,
            actorId: OTHER_OWNER,
            targetActorIds: [PLAIN]
          })

          const plainId = await seed(PLAIN, 'home-cross-owner', Timeline.MAIN)

          const ids = (
            await database.getTimeline({
              timeline: Timeline.MAIN,
              actorId: OWNER
            })
          ).map((status) => status.id)

          expect(ids).toContain(plainId)
        })

        it('reflects exclusive toggles on already-stored statuses at read time', async () => {
          // Read-time filtering (vs fan-out) must retroactively hide/show posts
          // that are already in the timelines table when `exclusive` is toggled.
          const TOGGLE_MEMBER = `https://${TEST_DOMAIN}/users/excl-toggle`
          await account('excl-toggle')
          const list = await database.createList({
            actorId: OWNER,
            title: 'Toggle',
            exclusive: false
          })
          await database.addListAccounts({
            listId: list.id,
            actorId: OWNER,
            targetActorIds: [TOGGLE_MEMBER]
          })

          const toggleId = await seed(
            TOGGLE_MEMBER,
            'home-toggle',
            Timeline.MAIN
          )
          const homeIds = async () =>
            (
              await database.getTimeline({
                timeline: Timeline.MAIN,
                actorId: OWNER
              })
            ).map((status) => status.id)

          // Non-exclusive: visible.
          expect(await homeIds()).toContain(toggleId)

          // Flip exclusive on: the already-stored status disappears.
          await database.updateList({
            id: list.id,
            actorId: OWNER,
            exclusive: true
          })
          expect(await homeIds()).not.toContain(toggleId)

          // Flip it back off: the same row reappears, no re-fan-out needed.
          await database.updateList({
            id: list.id,
            actorId: OWNER,
            exclusive: false
          })
          expect(await homeIds()).toContain(toggleId)
        })
      })
    })

    describe('getLocalPublicStatusesCount', () => {
      const COUNT_ACTOR = `https://${TEST_DOMAIN}/users/count-public`

      beforeAll(async () => {
        await database.createActor({
          actorId: COUNT_ACTOR,
          username: 'count-public',
          domain: TEST_DOMAIN,
          publicKey: 'publicKey-count-public',
          privateKey: 'privateKey-count-public',
          inboxUrl: `${COUNT_ACTOR}/inbox`,
          sharedInboxUrl: `${COUNT_ACTOR}/inbox`,
          followersUrl: `${COUNT_ACTOR}/followers`,
          createdAt: Date.now()
        })
      })

      afterAll(async () => {
        await database.deleteActor({ actorId: COUNT_ACTOR })
      })

      it('counts only top-level public statuses, ignoring replies and non-public posts', async () => {
        // Assert on the delta rather than an absolute count: the public
        // timeline is server-wide and other suites seed public posts too.
        const before = await database.getLocalPublicStatusesCount()

        await database.createNote({
          actorId: COUNT_ACTOR,
          cc: [],
          to: [ACTIVITY_STREAM_PUBLIC],
          id: `${COUNT_ACTOR}/statuses/count-public-1`,
          text: 'Counted public status',
          url: `${COUNT_ACTOR}/statuses/count-public-1`,
          reply: '',
          createdAt: Date.now()
        })
        await database.createNote({
          actorId: COUNT_ACTOR,
          cc: [],
          to: [ACTIVITY_STREAM_PUBLIC],
          id: `${COUNT_ACTOR}/statuses/count-public-2`,
          text: 'Second counted public status',
          url: `${COUNT_ACTOR}/statuses/count-public-2`,
          reply: '',
          createdAt: Date.now()
        })
        // A reply: excluded (reply !== '').
        await database.createNote({
          actorId: COUNT_ACTOR,
          cc: [],
          to: [ACTIVITY_STREAM_PUBLIC],
          id: `${COUNT_ACTOR}/statuses/count-reply`,
          text: 'A public reply that should not count',
          url: `${COUNT_ACTOR}/statuses/count-reply`,
          reply: `${COUNT_ACTOR}/statuses/count-public-1`,
          createdAt: Date.now()
        })
        // Followers-only: excluded (not addressed to the public collection).
        await database.createNote({
          actorId: COUNT_ACTOR,
          cc: [`${COUNT_ACTOR}/followers`],
          to: [],
          id: `${COUNT_ACTOR}/statuses/count-followers`,
          text: 'A followers-only status that should not count',
          url: `${COUNT_ACTOR}/statuses/count-followers`,
          reply: '',
          createdAt: Date.now()
        })

        const after = await database.getLocalPublicStatusesCount()
        expect(after - before).toBe(2)
      }, 10000)

      it('stops counting at the given limit', async () => {
        // At least the two public posts from the previous case exist, so a
        // limit of 1 must short-circuit to exactly 1.
        const limited = await database.getLocalPublicStatusesCount(1)
        expect(limited).toBe(1)
      }, 10000)
    })
  })
})
