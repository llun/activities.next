import crypto from 'crypto'
import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import {
  createFreshDatabaseRunner,
  createSigningAccount,
  seedActorTestDatabase
} from '@/lib/database/sql/actorTestHelpers'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { listTimelineKey } from '@/lib/services/timelines/types'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { type StatusPoll } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('ActorDatabase deletion', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (backendName, database) => {
    const withFreshDatabase = createFreshDatabaseRunner(backendName)
    const withFreshDatabaseAndInstance = withFreshDatabase

    beforeAll(async () => {
      await seedActorTestDatabase(database)
    })

    describe('deleteActor', () => {
      it('deletes actor by id', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `delete-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        await database.deleteActor({ actorId })
        const deleted = await database.getActorFromId({ id: actorId })
        expect(deleted).toBeNull()
      })
    })

    describe('scheduleActorDeletion', () => {
      it('schedules immediate deletion', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `schedule-del-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        await database.scheduleActorDeletion({ actorId, scheduledAt: null })
        const status = await database.getActorDeletionStatus({ id: actorId })
        expect(status?.status).toEqual('scheduled')
        expect(status?.scheduledAt).toBeNull()
      })

      it('schedules delayed deletion', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `schedule-del2-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        const scheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
        await database.scheduleActorDeletion({ actorId, scheduledAt })
        const status = await database.getActorDeletionStatus({ id: actorId })
        expect(status?.status).toEqual('scheduled')
        expect(status?.scheduledAt).toBeNumber()
      })
    })

    describe('cancelActorDeletion', () => {
      it('cancels scheduled deletion', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `cancel-del-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        await database.scheduleActorDeletion({ actorId, scheduledAt: null })
        await database.cancelActorDeletion({ actorId })
        const status = await database.getActorDeletionStatus({ id: actorId })
        expect(status?.status).toBeNull()
        expect(status?.scheduledAt).toBeNull()
      })
    })

    describe('startActorDeletion', () => {
      it('starts deletion process', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `start-del-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        await database.scheduleActorDeletion({ actorId, scheduledAt: null })
        await database.startActorDeletion({ actorId })
        const status = await database.getActorDeletionStatus({ id: actorId })
        expect(status?.status).toEqual('deleting')
      })
    })

    describe('getActorsScheduledForDeletion', () => {
      it('returns actors scheduled for deletion before given date', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `get-del-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        const pastDate = new Date(Date.now() - 1000)
        await database.scheduleActorDeletion({ actorId, scheduledAt: pastDate })
        const actors = await database.getActorsScheduledForDeletion({
          beforeDate: new Date()
        })
        expect(actors.some((a) => a.id === actorId)).toBeTrue()
      })

      it('does not return actors scheduled for future deletion', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `get-del2-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
        await database.scheduleActorDeletion({
          actorId,
          scheduledAt: futureDate
        })
        const actors = await database.getActorsScheduledForDeletion({
          beforeDate: new Date()
        })
        expect(actors.some((a) => a.id === actorId)).toBeFalse()
      })
    })

    describe('getNodeInfoStats', () => {
      it('increments totalUsers and localPosts counters on create', async () => {
        const statsBefore = await database.getNodeInfoStats()

        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `nodeinfo-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        const statusId = `${actorId}/statuses/nodeinfo-${suffix}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'NodeInfo test status'
        })

        const statsAfter = await database.getNodeInfoStats()
        expect(statsAfter.totalUsers).toBe(statsBefore.totalUsers + 1)
        expect(statsAfter.localPosts).toBe(statsBefore.localPosts + 1)
      })

      it('does not count external actors in local stats', async () => {
        const statsBefore = await database.getNodeInfoStats()

        const suffix = crypto.randomUUID().slice(0, 8)
        const externalActorId = `https://external-${suffix}.example/users/ext`

        await database.createActor({
          actorId: externalActorId,
          username: `ext-${suffix}`,
          domain: `external-${suffix}.example`,
          followersUrl: `${externalActorId}/followers`,
          inboxUrl: `${externalActorId}/inbox`,
          sharedInboxUrl: `${externalActorId}/inbox`,
          publicKey: 'externalPublicKey',
          createdAt: Date.now()
        })

        const statsAfter = await database.getNodeInfoStats()
        expect(statsAfter.totalUsers).toBe(statsBefore.totalUsers)
        expect(statsAfter.localPosts).toBe(statsBefore.localPosts)
      })

      it('does not count external actor posts in local stats', async () => {
        const statsBefore = await database.getNodeInfoStats()

        const suffix = crypto.randomUUID().slice(0, 8)
        const externalActorId = `https://ext-post-${suffix}.example/users/ext`

        await database.createActor({
          actorId: externalActorId,
          username: `ext-post-${suffix}`,
          domain: `ext-post-${suffix}.example`,
          followersUrl: `${externalActorId}/followers`,
          inboxUrl: `${externalActorId}/inbox`,
          sharedInboxUrl: `${externalActorId}/inbox`,
          publicKey: 'externalPublicKey',
          createdAt: Date.now()
        })

        await database.createNote({
          id: `${externalActorId}/statuses/ext-${suffix}`,
          url: `${externalActorId}/statuses/ext-${suffix}`,
          actorId: externalActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'External post'
        })

        const statsAfter = await database.getNodeInfoStats()
        expect(statsAfter.localPosts).toBe(statsBefore.localPosts)
      })
    })

    describe('deleteActorData', () => {
      it('removes the deleted actor featured tags', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `delete-featured-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })
        await database.createFeaturedTag({ actorId, name: 'cleanup' })
        expect(await database.countFeaturedTags({ actorId })).toBe(1)

        await database.deleteActorData({ actorId })

        expect(await database.countFeaturedTags({ actorId })).toBe(0)
      })

      it('removes emoji reactions the deleted actor made', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `delete-reaction-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        const authorId = `https://${TEST_DOMAIN}/users/react-author-${suffix}`
        const statusId = `${authorId}/statuses/reacted-${suffix}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })
        await database.createAccount({
          email: `react-author-${suffix}@${TEST_DOMAIN}`,
          username: `react-author-${suffix}`,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-author-${suffix}`,
          publicKey: `publicKey-author-${suffix}`
        })
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: authorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Reacted status'
        })
        await database.createStatusReaction({
          statusId,
          actorId,
          name: `react-${suffix}`
        })
        expect(
          await database.getStatusReactionActors({
            statusId,
            name: `react-${suffix}`
          })
        ).toHaveLength(1)

        await database.deleteActorData({ actorId })

        // Otherwise a re-registered username reclaiming this actor URL would
        // inherit the reaction as its own.
        expect(
          await database.getStatusReactionActors({
            statusId,
            name: `react-${suffix}`
          })
        ).toEqual([])
      })

      it('removes reactions other actors left on the deleted actor statuses', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `delete-reacted-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        const statusId = `${actorId}/statuses/reacted-${suffix}`
        const reactorId = `https://remote.test/users/reactor-${suffix}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Status others reacted to'
        })
        await database.createStatusReaction({
          statusId,
          actorId: reactorId,
          name: `react-${suffix}`
        })
        expect(
          await database.getStatusReactionRollups({ statusIds: [statusId] })
        ).toHaveLength(1)

        await database.deleteActorData({ actorId })

        // The per-status cleanup branch: the reaction belongs to a remote actor,
        // so only the statusId sweep can remove it.
        expect(
          await database.getStatusReactionRollups({ statusIds: [statusId] })
        ).toEqual([])
      })

      it('removes account notes referencing the deleted actor on either side', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `delete-note-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        const peerActorId = `https://${TEST_DOMAIN}/users/delete-note-peer-${suffix}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })
        await database.createAccount({
          email: `peer-${suffix}@${TEST_DOMAIN}`,
          username: `delete-note-peer-${suffix}`,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-peer-${suffix}`,
          publicKey: `publicKey-peer-${suffix}`
        })

        // Note authored by the actor, and a note targeting the actor.
        await database.upsertAccountNote({
          actorId,
          targetActorId: peerActorId,
          comment: 'note I wrote'
        })
        await database.upsertAccountNote({
          actorId: peerActorId,
          targetActorId: actorId,
          comment: 'note about me'
        })

        await database.deleteActorData({ actorId })

        await expect(
          database.getAccountNote({ actorId, targetActorId: peerActorId })
        ).resolves.toBe('')
        await expect(
          database.getAccountNote({
            actorId: peerActorId,
            targetActorId: actorId
          })
        ).resolves.toBe('')
      })

      describe('deleting an actor that owns statuses, relationships and counters', () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `delete-data-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`
        const peerUsername = `delete-data-peer-${suffix}`
        const peerActorId = `https://${TEST_DOMAIN}/users/${peerUsername}`
        const targetStatusId = `${peerActorId}/statuses/delete-data-target-${suffix}`
        const pollStatusId = `${peerActorId}/statuses/delete-data-poll-${suffix}`
        const replyStatusId = `${actorId}/statuses/reply-${suffix}`
        const actorHashtag = `actor-delete-${suffix}`

        let accountId: string | undefined
        let editedMediaId = ''
        let before: Awaited<ReturnType<typeof readCounters>>
        let after: Awaited<ReturnType<typeof readCounters>>

        const readCounters = async () => {
          const [
            followers,
            following,
            likes,
            reblogs,
            replies,
            hashtagCount,
            mediaUsage,
            nodeInfo
          ] = await Promise.all([
            database.getActorFollowersCount({ actorId: peerActorId }),
            database.getActorFollowingCount({ actorId: peerActorId }),
            database.getLikeCount({ statusId: targetStatusId }),
            database.getStatusReblogsCount({ statusId: targetStatusId }),
            database.getStatusRepliesCount({ statusId: targetStatusId }),
            database.getHashtagCounter({ hashtag: actorHashtag }),
            database.getStorageUsageForAccount({ accountId: accountId! }),
            database.getNodeInfoStats()
          ])
          return {
            followers,
            following,
            likes,
            reblogs,
            replies,
            hashtagCount,
            mediaUsage,
            nodeInfo
          }
        }

        beforeAll(async () => {
          await database.createAccount({
            email: `${username}@${TEST_DOMAIN}`,
            username,
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: `privateKey-${suffix}`,
            publicKey: `publicKey-${suffix}`
          })
          await database.createAccount({
            email: `${peerUsername}@${TEST_DOMAIN}`,
            username: peerUsername,
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: `privateKey-peer-${suffix}`,
            publicKey: `publicKey-peer-${suffix}`
          })

          await database.createNote({
            id: targetStatusId,
            url: targetStatusId,
            actorId: peerActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Target status'
          })
          await database.createPoll({
            id: pollStatusId,
            url: pollStatusId,
            actorId: peerActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Peer poll',
            choices: ['Yes', 'No'],
            endAt: Date.now() + 60_000
          })

          await database.createNote({
            id: replyStatusId,
            url: replyStatusId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Reply from actor to delete',
            reply: targetStatusId
          })
          await database.createTag({
            statusId: replyStatusId,
            type: 'hashtag',
            name: `#${actorHashtag}`,
            value: `https://${TEST_DOMAIN}/tags/${actorHashtag}`
          })
          await database.increaseHashtagCounter({ hashtag: actorHashtag })
          await database.createAnnounce({
            id: `${actorId}/statuses/reblog-${suffix}`,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            originalStatusId: targetStatusId
          })
          await database.createLike({
            actorId,
            statusId: targetStatusId
          })
          await database.createFollow({
            actorId,
            targetActorId: peerActorId,
            inbox: `${actorId}/inbox`,
            sharedInbox: `${actorId}/inbox`,
            status: 'Accepted'
          })
          await database.createFollow({
            actorId: peerActorId,
            targetActorId: actorId,
            inbox: `${peerActorId}/inbox`,
            sharedInbox: `${peerActorId}/inbox`,
            status: 'Accepted'
          })
          const media = await database.createMedia({
            actorId,
            original: {
              path: `/tmp/delete-data-${suffix}.jpg`,
              bytes: 1700,
              mimeType: 'image/jpeg',
              metaData: { width: 100, height: 100 }
            }
          })
          editedMediaId = media!.id
          await expect(
            database.recordPollVotes({
              statusId: pollStatusId,
              actorId,
              choices: [0]
            })
          ).resolves.toBeTrue()
          await database.createPollAnswer({
            statusId: pollStatusId,
            actorId,
            choice: 0
          })

          const actor = await database.getActorFromId({ id: actorId })
          accountId = actor?.account?.id
          expect(accountId).toBeDefined()
          // A photo edit moves the 1700-byte upload into `media_edit_files`
          // and makes a 300-byte render the live file.
          await expect(
            database.applyMediaEdit({
              mediaId: editedMediaId,
              accountId: accountId!,
              baseVersion: 0,
              saveId: 'delete-data-edit',
              recipe: '{"v":1}',
              render: {
                path: `/tmp/delete-data-${suffix}-edit.webp`,
                bytes: 300,
                mimeType: 'image/webp',
                width: 100,
                height: 100,
                blurhash: null,
                focus: null
              }
            })
          ).resolves.toMatchObject({ status: 'ok' })
          await expect(
            database.hasActorVoted({ statusId: pollStatusId, actorId })
          ).resolves.toBeTrue()
          const pollBeforeDelete = (await database.getStatus({
            statusId: pollStatusId,
            currentActorId: peerActorId
          })) as StatusPoll
          expect(pollBeforeDelete.choices[0]).toMatchObject({ totalVotes: 1 })

          before = await readCounters()

          await database.deleteActorData({ actorId })

          after = await readCounters()
        })

        it('removes the actor row', async () => {
          const deletedActor = await database.getActorFromId({ id: actorId })
          expect(deletedActor).toBeNull()
        })

        it('rolls back the deleted actor poll votes and the choice tally', async () => {
          await expect(
            database.hasActorVoted({ statusId: pollStatusId, actorId })
          ).resolves.toBeFalse()
          await expect(
            database.getActorPollVotes({ statusId: pollStatusId, actorId })
          ).resolves.toEqual([])
          const pollAfterDelete = (await database.getStatus({
            statusId: pollStatusId,
            currentActorId: peerActorId
          })) as StatusPoll
          expect(pollAfterDelete.choices[0]).toMatchObject({ totalVotes: 0 })
        })

        it('decrements the follower and following counts of the peer actor', () => {
          expect(after.followers).toBe(before.followers - 1)
          expect(after.following).toBe(before.following - 1)
        })

        it('decrements the like, reblog and reply counts of the target status', () => {
          expect(after.likes).toBe(before.likes - 1)
          expect(after.reblogs).toBe(before.reblogs - 1)
          expect(after.replies).toBe(before.replies - 1)
        })

        it('decrements the hashtag counter and the account media usage', () => {
          expect(after.hashtagCount).toBe(before.hashtagCount - 1)
          // The upload kept by the edit (1700) and the live render (300).
          expect(after.mediaUsage).toBe(before.mediaUsage - 2000)
        })

        it('removes the photo edit rows of the actor media', async () => {
          await expect(
            database.listMediaEditFiles({ mediaIds: [editedMediaId] })
          ).resolves.toEqual([])
        })

        it('decrements the nodeinfo user and local post counters', () => {
          expect(after.nodeInfo.totalUsers).toBe(before.nodeInfo.totalUsers - 1)
          expect(after.nodeInfo.localPosts).toBe(before.nodeInfo.localPosts - 2)
        })
      })

      describe('deleting owned status-scoped data', () => {
        const knexDatabase = knex({
          client: 'better-sqlite3',
          useNullAsDefault: true,
          connection: {
            filename: ':memory:'
          }
        })
        const sqlDatabase = getSQLDatabase(knexDatabase)
        const actorId = 'https://remote.test/users/delete-actor-status-data'
        const voterId = 'https://remote.test/users/delete-actor-voter'
        const noteId = `${actorId}/statuses/history-cleanup`
        const pollId = `${actorId}/statuses/poll-cleanup`
        const queries: string[] = []
        const handleQuery = ({ sql }: { sql: string }) => {
          queries.push(sql.toLowerCase())
        }
        const currentTime = new Date()
        const countRows = async (tableName: string, statusId: string) => {
          const row = await knexDatabase(tableName)
            .where({ statusId })
            .count<{ count: number | string }>('* as count')
            .first()
          return Number(row?.count ?? 0)
        }

        beforeAll(async () => {
          await sqlDatabase.migrate()
          await sqlDatabase.createActor({
            actorId,
            username: 'delete-actor-status-data',
            domain: 'remote.test',
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            publicKey: 'public-key',
            createdAt: Date.now()
          })
          await sqlDatabase.createActor({
            actorId: voterId,
            username: 'delete-actor-voter',
            domain: 'remote.test',
            followersUrl: `${voterId}/followers`,
            inboxUrl: `${voterId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            publicKey: 'voter-public-key',
            createdAt: Date.now()
          })
          await sqlDatabase.createNote({
            id: noteId,
            url: noteId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Original history cleanup note'
          })
          await sqlDatabase.updateNote({
            statusId: noteId,
            text: 'Updated history cleanup note'
          })
          await sqlDatabase.createPoll({
            id: pollId,
            url: pollId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Poll cleanup',
            choices: ['One', 'Two'],
            endAt: Date.now() + 60_000
          })
          await sqlDatabase.recordPollVotes({
            statusId: pollId,
            actorId: voterId,
            choices: [0]
          })
          await knexDatabase('notifications').insert({
            id: 'delete-actor-status-notification',
            actorId: voterId,
            type: 'mention',
            sourceActorId: voterId,
            statusId: noteId,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          await knexDatabase('direct_conversation_statuses').insert({
            conversationId: 'delete-actor-status-conversation',
            statusId: noteId,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          await knexDatabase('fitness_files').insert({
            id: 'delete-actor-status-fitness-file',
            actorId: voterId,
            statusId: noteId,
            path: '/tmp/delete-actor-status.fit',
            fileName: 'delete-actor-status.fit',
            fileType: 'fit',
            mimeType: 'application/octet-stream',
            bytes: 100,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          await knexDatabase('counters').insert(
            [noteId, pollId]
              .flatMap((statusId) => [
                CounterKey.totalLike(statusId),
                CounterKey.totalReblog(statusId),
                CounterKey.totalReply(statusId)
              ])
              .map((id) => ({
                id,
                value: 1,
                createdAt: currentTime,
                updatedAt: currentTime
              }))
          )

          await expect(countRows('status_history', noteId)).resolves.toBe(1)
          await expect(countRows('poll_answers', pollId)).resolves.toBe(1)
          await expect(countRows('poll_voters', pollId)).resolves.toBe(1)
          await expect(countRows('notifications', noteId)).resolves.toBe(1)
          await expect(
            countRows('direct_conversation_statuses', noteId)
          ).resolves.toBe(1)
          await expect(countRows('fitness_files', noteId)).resolves.toBe(1)

          knexDatabase.on('query', handleQuery)
          await sqlDatabase.deleteActorData({ actorId })
          knexDatabase.off('query', handleQuery)
        })

        afterAll(async () => {
          knexDatabase.off('query', handleQuery)
          await knexDatabase.destroy()
        })

        it('removes status-scoped rows and nulls the fitness file statusId', async () => {
          await expect(countRows('status_history', noteId)).resolves.toBe(0)
          await expect(countRows('poll_answers', pollId)).resolves.toBe(0)
          await expect(countRows('poll_voters', pollId)).resolves.toBe(0)
          await expect(countRows('notifications', noteId)).resolves.toBe(0)
          await expect(
            countRows('direct_conversation_statuses', noteId)
          ).resolves.toBe(0)
          await expect(countRows('fitness_files', noteId)).resolves.toBe(0)
          await expect(
            knexDatabase('fitness_files')
              .where({ id: 'delete-actor-status-fitness-file' })
              .first('statusId')
          ).resolves.toEqual({ statusId: null })
          await expect(
            knexDatabase('counters')
              .whereIn(
                'id',
                [noteId, pollId].flatMap((statusId) => [
                  CounterKey.totalLike(statusId),
                  CounterKey.totalReblog(statusId),
                  CounterKey.totalReply(statusId)
                ])
              )
              .count<{ count: number | string }>('* as count')
              .first()
              .then((row) => Number(row?.count ?? 0))
          ).resolves.toBe(0)
        })

        it('cleans status-scoped tables with direct statusId deletes (query shape)', () => {
          const hasDirectStatusIdDelete = (tableName: string) =>
            queries.some(
              (sql) =>
                sql.startsWith('delete') &&
                sql.includes(`\`${tableName}\``) &&
                sql.includes('`statusid` in') &&
                !sql.includes('`actorid` in')
            )
          expect(hasDirectStatusIdDelete('status_history')).toBe(true)
          expect(hasDirectStatusIdDelete('poll_answers')).toBe(true)
          expect(hasDirectStatusIdDelete('poll_voters')).toBe(true)
          expect(hasDirectStatusIdDelete('notifications')).toBe(true)
          expect(hasDirectStatusIdDelete('direct_conversation_statuses')).toBe(
            true
          )
          expect(
            queries.some(
              (sql) =>
                sql.startsWith('update') &&
                sql.includes('`fitness_files`') &&
                sql.includes('`statusid` in')
            )
          ).toBe(true)
          expect(
            queries.some(
              (sql) =>
                sql.startsWith('delete') &&
                sql.includes('`counters`') &&
                sql.includes('`id` in')
            )
          ).toBe(true)
        })
      })

      it('removes list memberships of the deleted actor and the lists it owned', async () => {
        await withFreshDatabaseAndInstance(async (freshDatabase, instance) => {
          const deletedId = `https://${TEST_DOMAIN}/users/list-deleted`
          const ownerId = `https://${TEST_DOMAIN}/users/list-owner`
          const memberId = `https://${TEST_DOMAIN}/users/list-member`
          for (const actorId of [deletedId, ownerId, memberId]) {
            await createSigningAccount(
              freshDatabase,
              actorId.split('/').pop() as string
            )
          }
          const memberStatusId = `${memberId}/statuses/list-member-post`
          await freshDatabase.createNote({
            id: memberStatusId,
            url: memberStatusId,
            actorId: memberId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Member post'
          })

          // Another owner's list holding the deleted actor and a member who
          // stays, and a list the deleted actor owns with a backfilled feed.
          const ownerList = await freshDatabase.createList({
            actorId: ownerId,
            title: 'Owner list'
          })
          await freshDatabase.addListAccounts({
            listId: ownerList.id,
            actorId: ownerId,
            targetActorIds: [deletedId, memberId]
          })
          const deletedList = await freshDatabase.createList({
            actorId: deletedId,
            title: 'Deleted actor list'
          })
          await freshDatabase.addListAccounts({
            listId: deletedList.id,
            actorId: deletedId,
            targetActorIds: [memberId]
          })
          await expect(
            instance('timelines').where({
              timeline: listTimelineKey(deletedList.id)
            })
          ).resolves.toHaveLength(1)

          await freshDatabase.deleteActorData({ actorId: deletedId })

          await expect(
            instance('list_accounts')
              .where('targetActorId', deletedId)
              .orWhere('actorId', deletedId)
              .orWhere('listId', deletedList.id)
          ).resolves.toEqual([])
          await expect(
            instance('lists').where('actorId', deletedId)
          ).resolves.toEqual([])
          await expect(
            instance('timelines').where({
              timeline: listTimelineKey(deletedList.id)
            })
          ).resolves.toEqual([])
          // The other owner's list, its surviving member and that member's
          // feed rows are untouched.
          await expect(
            freshDatabase.getLists({ actorId: ownerId })
          ).resolves.toEqual([expect.objectContaining({ id: ownerList.id })])
          await expect(
            instance('list_accounts')
              .where('listId', ownerList.id)
              .pluck('targetActorId')
          ).resolves.toEqual([memberId])
          await expect(
            instance('timelines')
              .where({
                actorId: ownerId,
                timeline: listTimelineKey(ownerList.id)
              })
              .pluck('statusId')
          ).resolves.toEqual([memberStatusId])
        })
      })

      it('deletes markers when actor is deleted', async () => {
        const suffix = crypto.randomUUID().slice(0, 8)
        const username = `delete-markers-${suffix}`
        const actorId = `https://${TEST_DOMAIN}/users/${username}`

        await database.createAccount({
          email: `${username}@${TEST_DOMAIN}`,
          username,
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: `privateKey-${suffix}`,
          publicKey: `publicKey-${suffix}`
        })

        await database.upsertMarker({
          actorId,
          timeline: 'home',
          lastReadId: 'marker-delete-test'
        })
        await database.upsertMarker({
          actorId,
          timeline: 'notifications',
          lastReadId: 'marker-delete-test-2'
        })

        const before = await database.getMarkers({
          actorId,
          timelines: ['home', 'notifications']
        })
        expect(before).toHaveLength(2)

        await database.deleteActorData({ actorId })

        const after = await database.getMarkers({
          actorId,
          timelines: ['home', 'notifications']
        })
        expect(after).toEqual([])
      })
    })
  })
})
