import knex, { Knex } from 'knex'

import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Timeline } from '@/lib/services/timelines/types'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { FollowStatus } from '@/lib/types/domain/follow'
import { StatusNote, StatusPoll, StatusType } from '@/lib/types/domain/status'
import { TagType } from '@/lib/types/domain/tag'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { buildPubliclyReadableStatusIdsQuery } from './status'

describe('StatusDatabase', () => {
  const { actors, statuses } = DatabaseSeed
  const primaryActorId = actors.primary.id
  const replyAuthorId = actors.replyAuthor.id
  const pollAuthorId = actors.pollAuthor.id
  const extraActorId = actors.extra.id
  const emptyActorId = actors.empty.id
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe('public readable status SQL', () => {
    const createTargetStatusIds = (database: Knex) =>
      database('statuses')
        .select('statuses.id')
        .where('statuses.actorId', primaryActorId)

    it('seeds recursive public readability from the caller target set', async () => {
      const sqliteDatabase = knex({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: {
          filename: ':memory:'
        }
      })
      const sql = buildPubliclyReadableStatusIdsQuery({
        database: sqliteDatabase,
        targetStatusIds: createTargetStatusIds(sqliteDatabase)
      })
        .toSQL()
        .sql.toLowerCase()

      expect(sql).toContain('with recursive')
      expect(sql).toContain('actorid')
      expect(sql.indexOf('actorid')).toBeLessThan(sql.indexOf('union'))

      await sqliteDatabase.destroy()
    })

    it('does not use recursive CTEs for MySQL-compatible public readability SQL', async () => {
      const mysqlDatabase = knex({ client: 'mysql2' })
      const sql = buildPubliclyReadableStatusIdsQuery({
        database: mysqlDatabase,
        targetStatusIds: createTargetStatusIds(mysqlDatabase)
      })
        .toSQL()
        .sql.toLowerCase()

      expect(sql).not.toContain('with recursive')
      expect(sql).toContain('actorid')

      await mysqlDatabase.destroy()
    })
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database as Database)
    })

    describe('getStatus', () => {
      it('returns status without replies by default', async () => {
        const status = await database.getStatus({
          statusId: statuses.primary.post
        })
        expect(status).toEqual({
          id: statuses.primary.post,
          actorId: primaryActorId,
          actor: {
            id: primaryActorId,
            username: actors.primary.username,
            domain: actors.primary.domain,
            type: 'Person',
            followersUrl: `${primaryActorId}/followers`,
            inboxUrl: `${primaryActorId}/inbox`,
            sharedInboxUrl: `https://${actors.primary.domain}/inbox`,
            followingCount: 2,
            followersCount: 1,
            statusCount: 3,
            lastStatusAt: expect.toBeNumber(),
            createdAt: expect.toBeNumber(),
            manuallyApprovesFollowers: true
          },
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          edits: [],
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber(),
          type: 'Note',
          url: statuses.primary.post,
          text: 'This is Actor1 post',
          summary: '',
          reply: '',
          replies: [],
          actorAnnounceStatusId: null,
          isActorLiked: false,
          isLocalActor: true,
          totalLikes: 0,
          totalShares: 0,
          attachments: [],
          tags: []
        })
      })

      it('returns status with replies', async () => {
        const status = (await database.getStatus({
          statusId: statuses.primary.post,
          withReplies: true
        })) as StatusNote
        expect(status.replies).toHaveLength(2)
        expect(status).toMatchObject({
          id: statuses.primary.post,
          actorId: primaryActorId,
          actor: {
            id: primaryActorId,
            username: actors.primary.username,
            domain: actors.primary.domain,
            followersUrl: `${primaryActorId}/followers`,
            inboxUrl: `${primaryActorId}/inbox`,
            sharedInboxUrl: `https://${actors.primary.domain}/inbox`,
            followingCount: 2,
            followersCount: 1,
            createdAt: expect.toBeNumber()
          },
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          edits: [],
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber(),
          type: 'Note',
          url: statuses.primary.post,
          text: 'This is Actor1 post',
          summary: '',
          reply: '',
          actorAnnounceStatusId: null,
          isActorLiked: false,
          isLocalActor: true,
          totalLikes: 0,
          attachments: [],
          tags: []
        })
      })

      it('returns status with attachments', async () => {
        const status = (await database.getStatus({
          statusId: statuses.primary.postWithAttachments
        })) as StatusNote
        expect(status.attachments).toHaveLength(2)
        expect(status.attachments).toMatchObject([
          {
            id: expect.toBeString(),
            actorId: primaryActorId,
            statusId: statuses.primary.postWithAttachments,
            type: 'Document',
            mediaType: 'image/png',
            url: 'https://via.placeholder.com/150',
            width: 150,
            height: 150,
            name: '',
            createdAt: expect.toBeNumber(),
            updatedAt: expect.toBeNumber()
          },
          {
            id: expect.toBeString(),
            actorId: primaryActorId,
            statusId: statuses.primary.postWithAttachments,
            type: 'Document',
            mediaType: 'image/png',
            url: 'https://via.placeholder.com/150',
            width: 150,
            height: 150,
            name: '',
            createdAt: expect.toBeNumber(),
            updatedAt: expect.toBeNumber()
          }
        ])
      })

      it('returns status with tags', async () => {
        const status = (await database.getStatus({
          statusId: statuses.replyAuthor.mentionReplyToPrimary
        })) as StatusNote
        expect(status.tags).toHaveLength(1)
        expect(status.tags).toMatchObject([
          {
            id: expect.toBeString(),
            statusId: statuses.replyAuthor.mentionReplyToPrimary,
            type: 'mention',
            name: '@test1',
            value: 'https://llun.test/@test1',
            createdAt: expect.toBeNumber(),
            updatedAt: expect.toBeNumber()
          }
        ])
      })

      it('returns status with linked fitness file metadata', async () => {
        const statusId = `${emptyActorId}/statuses/fitness-status`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'This post has a linked fitness file'
        })

        const fitnessFile = await database.createFitnessFile({
          actorId: emptyActorId,
          statusId,
          path: `fitness/${Date.now()}-status.fit`,
          fileName: 'status.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 4096
        })

        const status = (await database.getStatus({ statusId })) as StatusNote
        expect(status.fitness).toMatchObject({
          id: fitnessFile?.id,
          fileName: 'status.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 4096,
          url: `/api/v1/fitness-files/${fitnessFile?.id}`
        })
      })

      it('returns announce status', async () => {
        const status = await database.getStatus({
          statusId: statuses.replyAuthor.announceOwn
        })
        expect(status).toMatchObject({
          id: statuses.replyAuthor.announceOwn,
          actorId: replyAuthorId,
          actor: {
            username: actors.replyAuthor.username,
            domain: actors.replyAuthor.domain
          },
          type: 'Announce',
          originalStatus: {
            id: statuses.replyAuthor.mentionReplyToPrimary,
            actorId: replyAuthorId,
            type: 'Note',
            text: expect.toBeString()
          }
        })
      })

      it('returns poll status', async () => {
        const status = await database.getStatus({
          statusId: statuses.poll.status
        })
        expect(status).toMatchObject({
          id: statuses.poll.status,
          actorId: pollAuthorId,
          type: 'Poll',
          url: statuses.poll.status,
          text: 'This is a poll',
          tags: [],
          choices: [
            {
              statusId: statuses.poll.status,
              title: 'Yes',
              totalVotes: 0
            },
            {
              statusId: statuses.poll.status,
              title: 'No',
              totalVotes: 0
            }
          ]
        })
      })
    })

    describe('getStatusFromUrl', () => {
      it('returns status by URL', async () => {
        const status = await database.getStatusFromUrl({
          url: statuses.primary.post
        })
        expect(status?.id).toBe(statuses.primary.post)
      })

      it('returns null for unknown URL', async () => {
        const status = await database.getStatusFromUrl({
          url: 'https://example.test/statuses/does-not-exist'
        })
        expect(status).toBeNull()
      })
    })

    describe('getStatusFromUrlHash', () => {
      it('returns status by URL hash', async () => {
        const status = await database.getStatusFromUrlHash({
          urlHash: getHashFromString(statuses.primary.post)
        })
        expect(status?.id).toBe(statuses.primary.post)
      })

      it('returns status by URL hash scoped to actor', async () => {
        const status = await database.getStatusFromUrlHash({
          urlHash: getHashFromString(statuses.primary.post),
          actorId: primaryActorId
        })
        expect(status?.id).toBe(statuses.primary.post)
      })

      it('returns null for unknown URL hash', async () => {
        const status = await database.getStatusFromUrlHash({
          urlHash: getHashFromString(
            'https://example.test/statuses/does-not-exist'
          )
        })
        expect(status).toBeNull()
      })

      it('returns null for actor mismatch', async () => {
        const status = await database.getStatusFromUrlHash({
          urlHash: getHashFromString(statuses.primary.post),
          actorId: replyAuthorId
        })
        expect(status).toBeNull()
      })
    })

    describe('getActorStatuses', () => {
      it('returns statuses for specific actor', async () => {
        const statuses = await database.getActorStatuses({
          actorId: primaryActorId
        })
        expect(statuses).toHaveLength(3)
        expect(statuses.map((item) => (item as StatusNote).text)).toEqual([
          'This is Actor1 post 3',
          'This is Actor1 post 2',
          'This is Actor1 post'
        ])
      })

      it('paginates statuses that share createdAt using id as a tiebreaker', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const createdAt = Date.UTC(2035, 0, 1)
        const firstStatusId = `${emptyActorId}/statuses/tie-z-${suffix}`
        const secondStatusId = `${emptyActorId}/statuses/tie-y-${suffix}`
        const thirdStatusId = `${emptyActorId}/statuses/tie-x-${suffix}`

        await database.createNote({
          id: firstStatusId,
          url: firstStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Tie ordered status z',
          createdAt
        })
        await database.createNote({
          id: secondStatusId,
          url: secondStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Tie ordered status y',
          createdAt
        })
        await database.createNote({
          id: thirdStatusId,
          url: thirdStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Tie ordered status x',
          createdAt
        })

        const firstPage = await database.getActorStatuses({
          actorId: emptyActorId,
          limit: 2
        })
        const secondPage = await database.getActorStatuses({
          actorId: emptyActorId,
          maxStatusId: secondStatusId,
          limit: 2
        })

        expect(firstPage.map((status) => status.id)).toEqual([
          firstStatusId,
          secondStatusId
        ])
        expect(secondPage.map((status) => status.id)).toContain(thirdStatusId)
      })
    })

    describe('getActorStatusesCount', () => {
      it('returns total number of statuses for the specific actor', async () => {
        const count = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        expect(count).toBe(3)
      })

      it('counts only publicly readable actor statuses when requested', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const publicStatusId = `${emptyActorId}/statuses/public-${suffix}`
        const privateStatusId = `${emptyActorId}/statuses/private-${suffix}`
        const privateAnnounceId = `${emptyActorId}/statuses/announce-private-${suffix}`
        const beforePublicCount = await database.getActorStatusesCount({
          actorId: emptyActorId,
          publicOnly: true
        })

        await database.createNote({
          id: publicStatusId,
          url: publicStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Public count status'
        })
        await database.createNote({
          id: privateStatusId,
          url: privateStatusId,
          actorId: emptyActorId,
          to: [`${emptyActorId}/followers`],
          cc: [],
          text: 'Private count status'
        })
        await database.createAnnounce({
          id: privateAnnounceId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: privateStatusId
        })

        const count = await database.getActorStatusesCount({
          actorId: emptyActorId,
          publicOnly: true
        })
        const statuses = await database.getActorStatuses({
          actorId: emptyActorId,
          publicOnly: true,
          limit: 50
        })
        const publicStatusIds = statuses.map((status) => status.id)

        expect(count).toBe(beforePublicCount + 1)
        expect(publicStatusIds).toContain(publicStatusId)
        expect(publicStatusIds).not.toContain(privateStatusId)
        expect(publicStatusIds).not.toContain(privateAnnounceId)
      })

      it('excludes nested announces when the boosted original is not publicly readable', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const privateStatusId = `${emptyActorId}/statuses/nested-private-${suffix}`
        const firstAnnounceId = `${emptyActorId}/statuses/nested-announce-private-${suffix}`
        const nestedAnnounceId = `${emptyActorId}/statuses/nested-announce-public-${suffix}`
        const beforePublicCount = await database.getActorStatusesCount({
          actorId: emptyActorId,
          publicOnly: true
        })

        await database.createNote({
          id: privateStatusId,
          url: privateStatusId,
          actorId: emptyActorId,
          to: [`${emptyActorId}/followers`],
          cc: [],
          text: 'Private nested root status'
        })
        await database.createAnnounce({
          id: firstAnnounceId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: privateStatusId
        })
        await database.createAnnounce({
          id: nestedAnnounceId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: firstAnnounceId
        })

        const count = await database.getActorStatusesCount({
          actorId: emptyActorId,
          publicOnly: true
        })
        const statuses = await database.getActorStatuses({
          actorId: emptyActorId,
          publicOnly: true,
          limit: 50
        })
        const publicStatusIds = statuses.map((status) => status.id)

        expect(count).toBe(beforePublicCount)
        expect(publicStatusIds).not.toContain(privateStatusId)
        expect(publicStatusIds).not.toContain(firstAnnounceId)
        expect(publicStatusIds).not.toContain(nestedAnnounceId)
      })
    })

    describe('getActorStatuses followers audience fallback', () => {
      it('includes fallback actor followers audience for followers-only reads', async () => {
        const statusId = `${primaryActorId}/statuses/fallback-followers-${Date.now()}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: primaryActorId,
          to: [`${primaryActorId}/followers`],
          cc: [],
          text: 'Fallback followers audience'
        })

        const statuses = await database.getActorStatuses({
          actorId: primaryActorId,
          includeFollowersOnly: true,
          followersAudience: `${primaryActorId}/followers-updated`,
          limit: 50
        })

        expect(statuses.map((status) => status.id)).toContain(statusId)
      })
    })

    describe('getStatusReplies', () => {
      it('returns replies for specific status', async () => {
        const replies = await database.getStatusReplies({
          statusId: statuses.primary.post
        })
        expect(replies).toHaveLength(2)

        expect((replies[0] as StatusNote).text).toBe(
          'This is Actor2 reply to Actor1'
        )
        expect((replies[1] as StatusNote).text).toBe(
          '<p><span class="h-card"><a href="https://test.llun.dev/@test1@llun.test" target="_blank" class="u-url mention">@<span>test1</span></a></span> This is Actor1 post</p>'
        )
      })

      it('filters replies to statuses potentially visible to the current actor', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const parentStatusId = `${primaryActorId}/statuses/context-parent-${suffix}`
        const publicReplyId = `${replyAuthorId}/statuses/context-public-${suffix}`
        const directReplyId = `${replyAuthorId}/statuses/context-direct-${suffix}`
        const hiddenReplyId = `${replyAuthorId}/statuses/context-hidden-${suffix}`
        const createdAt = Date.now()

        await database.createNote({
          id: parentStatusId,
          url: parentStatusId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Context parent',
          createdAt
        })
        await database.createNote({
          id: publicReplyId,
          url: publicReplyId,
          actorId: replyAuthorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Public context reply',
          reply: parentStatusId,
          createdAt: createdAt + 1
        })
        await database.createNote({
          id: directReplyId,
          url: directReplyId,
          actorId: replyAuthorId,
          to: [extraActorId],
          cc: [],
          text: 'Direct context reply',
          reply: parentStatusId,
          createdAt: createdAt + 2
        })
        await database.createNote({
          id: hiddenReplyId,
          url: hiddenReplyId,
          actorId: replyAuthorId,
          to: [primaryActorId],
          cc: [],
          text: 'Hidden context reply',
          reply: parentStatusId,
          createdAt: createdAt + 3
        })

        const replies = await database.getStatusReplies({
          statusId: parentStatusId,
          visibleToActorId: extraActorId
        })

        expect(replies.map((status) => status.id)).toEqual([
          directReplyId,
          publicReplyId
        ])
      })

      it("includes followers-only replies using the reply author's stored followersUrl", async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const customActorId = `https://remote.test/users/context-author-${suffix}`
        const customFollowersUrl = `https://remote.test/collections/context-author-${suffix}/followers`
        const parentStatusId = `${primaryActorId}/statuses/context-custom-followers-parent-${suffix}`
        const replyStatusId = `${customActorId}/statuses/context-custom-followers-reply`

        await database.createActor({
          actorId: customActorId,
          username: `context-author-${suffix}`,
          domain: 'remote.test',
          followersUrl: customFollowersUrl,
          inboxUrl: `${customActorId}/inbox`,
          sharedInboxUrl: 'https://remote.test/inbox',
          publicKey: `public-key-${suffix}`,
          createdAt: Date.now()
        })
        await database.createFollow({
          actorId: extraActorId,
          targetActorId: customActorId,
          inbox: `${extraActorId}/inbox`,
          sharedInbox: `${extraActorId}/inbox`,
          status: FollowStatus.enum.Accepted
        })
        await database.createNote({
          id: parentStatusId,
          url: parentStatusId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Context parent for custom followers reply'
        })
        await database.createNote({
          id: replyStatusId,
          url: replyStatusId,
          actorId: customActorId,
          to: [customFollowersUrl],
          cc: [],
          text: 'Custom followers reply',
          reply: parentStatusId
        })

        const replies = await database.getStatusReplies({
          statusId: parentStatusId,
          visibleToActorId: extraActorId
        })

        expect(replies.map((status) => status.id)).toEqual([replyStatusId])
      })
    })

    describe('hasActorAnnouncedStatus', () => {
      it('returns true if actor has announced status', async () => {
        const result = await database.hasActorAnnouncedStatus({
          statusId: statuses.replyAuthor.mentionReplyToPrimary,
          actorId: replyAuthorId
        })
        expect(result).toBeTrue()
      })

      it('returns false if actor has not announced status', async () => {
        const result = await database.hasActorAnnouncedStatus({
          statusId: statuses.primary.post,
          actorId: primaryActorId
        })
        expect(result).toBeFalse()
      })
    })

    describe('getActorAnnounceStatus', () => {
      it('returns announce status for actor', async () => {
        const announce = await database.getActorAnnounceStatus({
          statusId: statuses.primary.postWithAttachments,
          actorId: replyAuthorId
        })
        expect(announce).toMatchObject({
          id: statuses.replyAuthor.announcePrimary,
          actorId: replyAuthorId,
          type: 'Announce'
        })
      })

      it('returns null when actor has not announced status', async () => {
        const announce = await database.getActorAnnounceStatus({
          statusId: statuses.primary.postWithAttachments,
          actorId: primaryActorId
        })
        expect(announce).toBeNull()
      })
    })

    describe('getStatusReblogsCount', () => {
      it('returns reblog count for announced status', async () => {
        const count = await database.getStatusReblogsCount({
          statusId: statuses.primary.postWithAttachments
        })
        expect(count).toBe(1)
      })

      it('returns zero when no reblogs exist', async () => {
        const count = await database.getStatusReblogsCount({
          statusId: statuses.primary.post
        })
        expect(count).toBe(0)
      })
    })

    describe('getStatusRepliesCount', () => {
      it('returns reply count for status with replies', async () => {
        const count = await database.getStatusRepliesCount({
          statusId: statuses.primary.post
        })
        expect(count).toBe(2)
      })

      it('returns zero when status has no replies', async () => {
        const count = await database.getStatusRepliesCount({
          statusId: statuses.primary.secondPost
        })
        expect(count).toBe(0)
      })

      it('counts replies that reference parent URL', async () => {
        const parentStatusId = `${emptyActorId}/statuses/url-parent`
        const parentStatusUrl = `${emptyActorId}/statuses/url-parent`

        await database.createNote({
          id: parentStatusId,
          url: parentStatusUrl,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Parent status for URL-based reply counting'
        })

        await database.createNote({
          id: `${pollAuthorId}/statuses/url-reply`,
          url: `${pollAuthorId}/statuses/url-reply`,
          actorId: pollAuthorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Reply by parent URL',
          reply: parentStatusUrl
        })

        const count = await database.getStatusRepliesCount({
          statusId: parentStatusId
        })
        expect(count).toBe(1)
      })
    })

    describe('getFavouritedBy', () => {
      it('returns actors who favourited the status', async () => {
        const actors = await database.getFavouritedBy({
          statusId: statuses.primary.post
        })
        expect(actors).toHaveLength(0)
      })

      it('returns actors who favourited the status', async () => {
        const actors = await database.getFavouritedBy({
          statusId: statuses.poll.status
        })
        expect(actors).toHaveLength(1)
        expect(actors[0].id).toBe(replyAuthorId)
      })

      it('supports limit and offset pagination', async () => {
        const statusId = statuses.primary.post
        await database.createLike({ actorId: primaryActorId, statusId })
        await database.createLike({ actorId: replyAuthorId, statusId })
        await database.createLike({ actorId: pollAuthorId, statusId })

        const firstPage = await database.getFavouritedBy({
          statusId,
          limit: 2
        })
        const secondPage = await database.getFavouritedBy({
          statusId,
          limit: 2,
          offset: 2
        })

        expect(firstPage).toHaveLength(2)
        expect(secondPage).toHaveLength(1)

        const actorIds = [...firstPage, ...secondPage].map((item) => item.id)
        expect(new Set(actorIds).size).toBe(3)
        expect(actorIds).toEqual(
          expect.arrayContaining([primaryActorId, replyAuthorId, pollAuthorId])
        )
      })
    })

    describe('createNote', () => {
      it('creates a new note', async () => {
        const status = (await database.createNote({
          id: `${extraActorId}/statuses/new-post`,
          url: `${extraActorId}/statuses/new-post`,
          actorId: extraActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'This is a new post'
        })) as StatusNote
        expect(status.text).toBe('This is a new post')
        expect(
          await database.getActorStatusesCount({ actorId: extraActorId })
        ).toBe(1)
      })

      it('creates a new note with attachments', async () => {
        await database.createNote({
          id: `${extraActorId}/statuses/new-post-2`,
          url: `${extraActorId}/statuses/new-post-2`,
          actorId: extraActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'This is a new post with attachments'
        })
        await database.createAttachment({
          actorId: extraActorId,
          statusId: `${extraActorId}/statuses/new-post-2`,
          mediaType: 'image/png',
          url: 'https://via.placeholder.com/150',
          width: 150,
          height: 150
        })
        await database.createAttachment({
          actorId: extraActorId,
          statusId: `${extraActorId}/statuses/new-post-2`,
          mediaType: 'image/png',
          url: 'https://via.placeholder.com/150',
          width: 150,
          height: 150
        })
        const status = (await database.getStatus({
          statusId: `${extraActorId}/statuses/new-post-2`
        })) as StatusNote
        expect(status.text).toBe('This is a new post with attachments')
        expect(status.attachments).toHaveLength(2)
      })

      it('creates a new note with tags', async () => {
        await database.createNote({
          id: `${extraActorId}/statuses/new-post-3`,
          url: `${extraActorId}/statuses/new-post-3`,
          actorId: extraActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'This is a new post with tags'
        })
        const tag = await database.createTag({
          statusId: `${extraActorId}/statuses/new-post-3`,
          type: TagType.enum.mention,
          name: '@test1',
          value: 'https://llun.test/@test1'
        })
        const status = (await database.getStatus({
          statusId: `${extraActorId}/statuses/new-post-3`
        })) as StatusNote
        expect(status.text).toBe('This is a new post with tags')
        expect(status.tags).toHaveLength(1)
        expect(status.tags).toMatchObject([
          {
            id: tag.id,
            statusId: `${extraActorId}/statuses/new-post-3`,
            type: TagType.enum.mention,
            name: '@test1',
            value: 'https://llun.test/@test1',
            createdAt: tag.createdAt,
            updatedAt: tag.updatedAt
          }
        ])
      })
    })

    describe('updateNote', () => {
      it('updates note content and records edit history', async () => {
        const statusId = `${emptyActorId}/statuses/update-note`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Original note'
        })

        const updated = await database.updateNote({
          statusId,
          text: 'Updated note',
          summary: 'Updated summary'
        })
        expect(updated).toMatchObject({
          id: statusId,
          text: 'Updated note',
          summary: 'Updated summary'
        })

        const fetched = (await database.getStatus({
          statusId
        })) as StatusNote
        expect(fetched.edits).toHaveLength(1)
        expect(fetched.edits[0]).toMatchObject({
          text: 'Original note',
          summary: '',
          createdAt: expect.toBeNumber()
        })
      })

      it('replaces note media attachments without changing note text', async () => {
        const statusId = `${emptyActorId}/statuses/update-note-media`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Original note with media'
        })
        await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://example.com/old.jpg',
          width: 320,
          height: 240,
          name: 'old.jpg',
          mediaId: 'old-media'
        })

        const updated = await database.updateNote({
          statusId,
          text: 'Original note with media',
          summary: null,
          attachments: [
            {
              type: 'upload',
              id: 'new-media',
              mediaType: 'image/png',
              url: 'https://example.com/new.png',
              width: 640,
              height: 480,
              name: 'new.png'
            }
          ]
        })

        expect(updated).toMatchObject({
          id: statusId,
          text: 'Original note with media',
          attachments: [
            expect.objectContaining({
              mediaType: 'image/png',
              url: 'https://example.com/new.png',
              name: 'new.png'
            })
          ]
        })

        const attachments = await database.getAttachmentsWithMedia({
          statusId
        })
        expect(attachments).toHaveLength(1)
        expect(attachments[0]).toMatchObject({
          mediaId: 'new-media',
          url: 'https://example.com/new.png'
        })

        const fetched = (await database.getStatus({
          statusId
        })) as StatusNote
        expect(fetched.edits).toHaveLength(1)
      })

      it('preserves legacy attachments without media ids when replacing media', async () => {
        const statusId = `${emptyActorId}/statuses/update-note-preserve-legacy`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Original note with legacy media'
        })
        await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://example.com/old.jpg',
          width: 320,
          height: 240,
          name: 'old.jpg',
          mediaId: 'old-media'
        })
        const legacyAttachment = await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://remote.example/legacy.jpg',
          width: 480,
          height: 360,
          name: 'legacy.jpg'
        })

        const updated = await database.updateNote({
          statusId,
          text: 'Original note with legacy media',
          summary: null,
          attachments: [
            {
              type: 'upload',
              id: 'new-media',
              mediaType: 'image/png',
              url: 'https://example.com/new.png',
              width: 640,
              height: 480,
              name: 'new.png'
            }
          ]
        })

        expect(updated?.attachments).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: legacyAttachment.id,
              mediaId: null,
              url: 'https://remote.example/legacy.jpg',
              createdAt: legacyAttachment.createdAt
            }),
            expect.objectContaining({
              mediaId: 'new-media',
              url: 'https://example.com/new.png'
            })
          ])
        )

        const attachments = await database.getAttachments({ statusId })
        expect(attachments).toHaveLength(2)
        expect(attachments).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              mediaId: 'old-media'
            })
          ])
        )
      })

      it('clears only editable media while preserving legacy and fitness attachments', async () => {
        const statusId = `${emptyActorId}/statuses/update-note-clear-editable-media`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Original note with mixed attachments'
        })
        await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://example.com/old.jpg',
          width: 320,
          height: 240,
          name: 'old.jpg',
          mediaId: 'old-media'
        })
        const legacyAttachment = await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://remote.example/legacy.jpg',
          width: 480,
          height: 360,
          name: 'legacy.jpg'
        })
        const fitnessAttachment = await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'application/gpx+xml',
          url: 'https://example.com/api/v1/fitness-files/activity',
          name: 'activity.gpx',
          mediaId: 'fitness-media'
        })

        const updated = await database.updateNote({
          statusId,
          text: 'Original note with mixed attachments',
          summary: null,
          attachments: []
        })

        expect(updated?.attachments).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: legacyAttachment.id,
              mediaId: null
            }),
            expect.objectContaining({
              id: fitnessAttachment.id,
              mediaId: 'fitness-media'
            })
          ])
        )

        const attachments = await database.getAttachments({ statusId })
        expect(attachments).toHaveLength(2)
        expect(attachments).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              mediaId: 'old-media'
            })
          ])
        )
      })

      it('preserves existing editable attachment rows when their media id remains', async () => {
        const statusId = `${emptyActorId}/statuses/update-note-keep-existing-media`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Original note with existing media'
        })
        const existingAttachment = await database.createAttachment({
          actorId: emptyActorId,
          statusId,
          mediaType: 'image/jpeg',
          url: 'https://example.com/existing.jpg',
          width: 320,
          height: 240,
          name: 'existing.jpg',
          mediaId: 'existing-media',
          createdAt: new Date('2026-04-26T10:00:00.000Z').getTime()
        })

        await database.updateNote({
          statusId,
          text: 'Original note with existing media',
          summary: null,
          attachments: [
            {
              type: 'upload',
              id: 'existing-media',
              mediaType: 'image/jpeg',
              url: 'https://example.com/existing.jpg',
              width: 320,
              height: 240,
              name: 'existing.jpg'
            },
            {
              type: 'upload',
              id: 'new-media',
              mediaType: 'image/png',
              url: 'https://example.com/new.png',
              width: 640,
              height: 480,
              name: 'new.png'
            }
          ]
        })

        const attachments = await database.getAttachments({ statusId })
        expect(attachments).toHaveLength(2)
        expect(
          attachments.find(
            (attachment) => attachment.mediaId === 'existing-media'
          )
        ).toMatchObject({
          id: existingAttachment.id,
          createdAt: existingAttachment.createdAt,
          updatedAt: existingAttachment.updatedAt
        })
        expect(
          attachments.find((attachment) => attachment.mediaId === 'new-media')
        ).toMatchObject({
          url: 'https://example.com/new.png'
        })
      })
    })

    describe('updateNoteVisibility', () => {
      it('updates recipients when visibility changes', async () => {
        const statusId = `${emptyActorId}/statuses/update-note-visibility`
        const note = await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Original note for visibility test'
        })

        await addStatusToTimelines(database, note)

        const timelineBefore = await database.getTimeline({
          timeline: Timeline.MAIN,
          actorId: emptyActorId
        })
        expect(timelineBefore.some((s) => s.id === statusId)).toBeTrue()

        const followersUrl = `${emptyActorId}/followers`
        const updated = await database.updateNoteVisibility({
          statusId,
          to: [followersUrl],
          cc: []
        })

        expect(updated).not.toBeNull()
        expect(updated?.to).toEqual([followersUrl])
        expect(updated?.cc).toEqual([])

        const fetched = (await database.getStatus({ statusId })) as StatusNote
        expect(fetched.to).toEqual([followersUrl])
        expect(fetched.cc).toEqual([])
        expect(fetched.edits).toHaveLength(0)

        const timelineAfter = await database.getTimeline({
          timeline: Timeline.MAIN,
          actorId: emptyActorId
        })
        expect(timelineAfter.some((s) => s.id === statusId)).toBeFalse()
      })

      it('returns null for nonexistent statusId', async () => {
        const result = await database.updateNoteVisibility({
          statusId: 'https://nonexistent.example/statuses/does-not-exist',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        expect(result).toBeNull()
      })

      it('returns null for non-Note status type (Poll)', async () => {
        const result = await database.updateNoteVisibility({
          statusId: statuses.poll.status,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        expect(result).toBeNull()
      })

      it('returns null for non-Note status type (Announce)', async () => {
        const result = await database.updateNoteVisibility({
          statusId: statuses.replyAuthor.announceOwn,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        expect(result).toBeNull()
      })
    })

    describe('updatePoll', () => {
      it('updates poll content and choice totals', async () => {
        const pollId = `${emptyActorId}/statuses/poll-update`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Original poll',
          summary: 'Original summary',
          choices: ['Alpha', 'Beta'],
          endAt: Date.now() + 1000
        })

        const updated = await database.updatePoll({
          statusId: pollId,
          text: 'Updated poll',
          summary: 'Updated summary',
          choices: [
            { title: 'Alpha', totalVotes: 2 },
            { title: 'Beta', totalVotes: 1 }
          ]
        })

        expect(updated).toMatchObject({
          id: pollId,
          text: 'Updated poll',
          summary: 'Updated summary'
        })

        const fetched = (await database.getStatus({
          statusId: pollId
        })) as StatusPoll
        expect(fetched.edits).toHaveLength(1)
        expect(fetched.choices).toMatchObject([
          { title: 'Alpha', totalVotes: 2 },
          { title: 'Beta', totalVotes: 1 }
        ])
      })
    })

    describe('poll votes', () => {
      it('records votes and increments choice totals', async () => {
        const pollId = `${emptyActorId}/statuses/poll-votes`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Vote poll',
          choices: ['Yes', 'No'],
          endAt: Date.now() + 1000
        })

        const voterId = replyAuthorId
        expect(
          await database.hasActorVoted({ statusId: pollId, actorId: voterId })
        ).toBeFalse()

        await database.createPollAnswer({
          statusId: pollId,
          actorId: voterId,
          choice: 0
        })
        await database.incrementPollChoiceVotes({
          statusId: pollId,
          choiceIndex: 0
        })

        expect(
          await database.hasActorVoted({ statusId: pollId, actorId: voterId })
        ).toBeTrue()
        expect(
          await database.getActorPollVotes({
            statusId: pollId,
            actorId: voterId
          })
        ).toEqual([0])

        const poll = (await database.getStatus({
          statusId: pollId,
          currentActorId: voterId
        })) as StatusPoll
        expect(poll.choices[0]).toMatchObject({ totalVotes: 1 })
        expect(poll).toMatchObject({
          voted: true,
          ownVotes: [0]
        })
      })

      it('records a Mastodon poll vote atomically and rejects duplicate voters', async () => {
        const pollId = `${emptyActorId}/statuses/record-poll-votes`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Vote poll',
          choices: ['Yes', 'No'],
          pollType: 'anyOf',
          endAt: Date.now() + 1000
        })

        const voterId = `${replyAuthorId}/record-poll-votes`
        await expect(
          database.recordPollVotes({
            statusId: pollId,
            actorId: voterId,
            choices: [0, 0, 1]
          })
        ).resolves.toBeTrue()
        await expect(
          database.recordPollVotes({
            statusId: pollId,
            actorId: voterId,
            choices: [1]
          })
        ).resolves.toBeFalse()

        expect(
          await database.getActorPollVotes({
            statusId: pollId,
            actorId: voterId
          })
        ).toEqual([0, 1])

        const poll = (await database.getStatus({
          statusId: pollId,
          currentActorId: voterId
        })) as StatusPoll
        expect(poll.choices).toMatchObject([
          { totalVotes: 1 },
          { totalVotes: 1 }
        ])
      })

      it('appends distinct federated anyOf choices without recounting duplicate choices', async () => {
        const pollId = `${emptyActorId}/statuses/record-poll-vote-append`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Vote poll',
          choices: ['Yes', 'No'],
          pollType: 'anyOf',
          endAt: Date.now() + 1000
        })

        const voterId = `${replyAuthorId}/record-poll-vote-append`
        await expect(
          database.recordPollVotes({
            statusId: pollId,
            actorId: voterId,
            choices: [0],
            allowAdditionalChoices: true
          })
        ).resolves.toBeTrue()
        await expect(
          database.recordPollVotes({
            statusId: pollId,
            actorId: voterId,
            choices: [1],
            allowAdditionalChoices: true
          })
        ).resolves.toBeTrue()
        await expect(
          database.recordPollVotes({
            statusId: pollId,
            actorId: voterId,
            choices: [0],
            allowAdditionalChoices: true
          })
        ).resolves.toBeFalse()

        const poll = (await database.getStatus({
          statusId: pollId,
          currentActorId: voterId
        })) as StatusPoll
        expect(poll.choices).toMatchObject([
          { totalVotes: 1 },
          { totalVotes: 1 }
        ])
        expect(poll.ownVotes).toEqual([0, 1])
      })
    })

    describe('createAnnounce', () => {
      const TEST_ID_ORIGINAL = `https://${TEST_DOMAIN}/users/announce-original`
      const TEST_ID_BOOSTER = `https://${TEST_DOMAIN}/users/announce-booster`
      const TEST_ID_FOLLOWER = `https://${TEST_DOMAIN}/users/announce-follower`

      beforeAll(async () => {
        await database.createAccount({
          email: `announce-original@${TEST_DOMAIN}`,
          username: 'announce-original',
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: 'privateKey-announce-original',
          publicKey: 'publicKey-announce-original'
        })
        await database.createAccount({
          email: `announce-booster@${TEST_DOMAIN}`,
          username: 'announce-booster',
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: 'privateKey-announce-booster',
          publicKey: 'publicKey-announce-booster'
        })
        await database.createAccount({
          email: `announce-follower@${TEST_DOMAIN}`,
          username: 'announce-follower',
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: 'privateKey-announce-follower',
          publicKey: 'publicKey-announce-follower'
        })
      })

      it('returns status with actorAnnounceStatusId in timeline', async () => {
        await database.createFollow({
          actorId: TEST_ID_BOOSTER,
          targetActorId: TEST_ID_ORIGINAL,
          status: FollowStatus.enum.Accepted,
          inbox: `${TEST_ID_BOOSTER}/inbox`,
          sharedInbox: `${TEST_ID_BOOSTER}/inbox`
        })
        await database.createFollow({
          actorId: TEST_ID_FOLLOWER,
          targetActorId: TEST_ID_BOOSTER,
          status: FollowStatus.enum.Accepted,
          inbox: `${TEST_ID_FOLLOWER}/inbox`,
          sharedInbox: `${TEST_ID_FOLLOWER}/inbox`
        })

        const originalPostId = `${TEST_ID_ORIGINAL}/posts/boost-original`
        const note = await database.createNote({
          id: originalPostId,
          url: originalPostId,
          actorId: TEST_ID_ORIGINAL,
          text: 'This is status for boost',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${TEST_ID_ORIGINAL}/followers`]
        })
        await addStatusToTimelines(database, note)

        const announcePostId = `${TEST_ID_BOOSTER}/posts/boost-announce`
        const announce = await database.createAnnounce({
          id: announcePostId,
          actorId: TEST_ID_BOOSTER,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${TEST_ID_BOOSTER}/followers`],
          originalStatusId: originalPostId
        })
        if (!announce) {
          fail('Announce must not be undefined')
        }
        await addStatusToTimelines(database, announce)

        const boosterTimeline = await database.getTimeline({
          timeline: Timeline.MAIN,
          actorId: TEST_ID_BOOSTER
        })
        const statusData = boosterTimeline.shift() as StatusNote
        expect(statusData.actorAnnounceStatusId).not.toBeNull()

        const followerTimeline = await database.getTimeline({
          timeline: Timeline.MAIN,
          actorId: TEST_ID_FOLLOWER
        })
        const announceStatus = followerTimeline.shift()
        if (announceStatus?.type !== StatusType.enum.Announce) {
          fail('Status must be announce')
        }

        const originalStatus = announceStatus.originalStatus
        expect(originalStatus.id).toEqual(note.id)
      })
    })

    describe('getStatusesByHashtag', () => {
      it('returns statuses with a given hashtag', async () => {
        const statusId = `${primaryActorId}/statuses/hashtag-test-${Date.now()}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Hello #testing'
        })
        await database.createTag({
          statusId,
          name: '#testing',
          value: `https://${actors.primary.domain}/tags/testing`,
          type: 'hashtag'
        })

        const results = await database.getStatusesByHashtag({
          hashtag: 'testing'
        })
        const ids = results.map((s) => s.id)
        expect(ids).toContain(statusId)
      })

      it('returns empty array for unknown hashtag', async () => {
        const results = await database.getStatusesByHashtag({
          hashtag: 'nonexistent_tag_xyz'
        })
        expect(results).toHaveLength(0)
      })
    })

    describe('hashtag counters', () => {
      it('increments and reads hashtag counter', async () => {
        const tag = `counter_test_${Date.now()}`
        await database.increaseHashtagCounter({ hashtag: tag })
        await database.increaseHashtagCounter({ hashtag: tag })
        const count = await database.getHashtagCounter({ hashtag: tag })
        expect(count).toBe(2)
      })

      it('decrements hashtag counter', async () => {
        const tag = `dec_test_${Date.now()}`
        await database.increaseHashtagCounter({ hashtag: tag })
        await database.increaseHashtagCounter({ hashtag: tag })
        await database.decreaseHashtagCounter({ hashtag: tag })
        const count = await database.getHashtagCounter({ hashtag: tag })
        expect(count).toBe(1)
      })

      it('handles hashtag with # prefix', async () => {
        const tag = `prefix_test_${Date.now()}`
        await database.increaseHashtagCounter({ hashtag: `#${tag}` })
        const count = await database.getHashtagCounter({ hashtag: tag })
        expect(count).toBe(1)
      })

      it('decreases hashtag counter when status with hashtag is deleted', async () => {
        const tag = `delete_counter_test_${Date.now()}`
        const statusId = `${primaryActorId}/statuses/hashtag-delete-${Date.now()}`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: `Hello #${tag}`
        })
        await database.createTag({
          statusId,
          name: `#${tag}`,
          value: `https://${actors.primary.domain}/tags/${tag}`,
          type: 'hashtag'
        })
        await database.increaseHashtagCounter({ hashtag: tag })

        const beforeCount = await database.getHashtagCounter({ hashtag: tag })
        expect(beforeCount).toBe(1)

        await database.deleteStatus({ statusId })

        const afterCount = await database.getHashtagCounter({ hashtag: tag })
        expect(afterCount).toBe(0)
      })
    })

    describe('deleteStatus', () => {
      it('deletes a status', async () => {
        const beforeDeleteCount = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        await database.deleteStatus({
          statusId: statuses.primary.secondPost
        })
        const afterDeleteCount = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        expect(
          await database.getStatus({
            statusId: statuses.primary.secondPost
          })
        ).toBeNull()
        expect(afterDeleteCount).toBe(beforeDeleteCount - 1)
      })

      it('deletes a status and attachments', async () => {
        const beforeDeleteCount = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        await database.deleteStatus({
          statusId: statuses.primary.postWithAttachments
        })
        const afterDeleteCount = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        expect(
          await database.getStatus({
            statusId: statuses.primary.postWithAttachments
          })
        ).toBeNull()
        expect(
          await database.getAttachments({
            statusId: statuses.primary.postWithAttachments
          })
        ).toBeArrayOfSize(0)
        expect(afterDeleteCount).toBe(beforeDeleteCount - 1)
      })

      it('deletes a status when the scoped actor id matches after normalization', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const rawActorId = `https://Remote.Test/users/delete-author-${suffix}#main-key`
        const normalizedActorId = normalizeActorId(rawActorId)
        const statusId = `${rawActorId}/statuses/delete-normalized`

        expect(normalizedActorId).toBeString()
        expect(normalizedActorId).not.toBe(rawActorId)

        await database.createActor({
          actorId: rawActorId,
          username: `delete-author-${suffix}`,
          domain: 'remote.test',
          followersUrl: `${rawActorId}/followers`,
          inboxUrl: `${rawActorId}/inbox`,
          sharedInboxUrl: 'https://remote.test/inbox',
          publicKey: `public-key-${suffix}`,
          createdAt: Date.now()
        })
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: rawActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Delete with normalized actor id'
        })

        await database.deleteStatus({
          statusId,
          actorId: normalizedActorId ?? undefined
        })

        expect(await database.getStatus({ statusId })).toBeNull()
      })

      it('decreases reply counter when deleting a reply', async () => {
        const parentStatusId = statuses.primary.post
        const replyStatusId = `${extraActorId}/statuses/reply-counter-delete-test`

        const beforeRepliesCount = await database.getStatusRepliesCount({
          statusId: parentStatusId
        })

        await database.createNote({
          id: replyStatusId,
          url: replyStatusId,
          actorId: extraActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Reply for delete counter test',
          reply: parentStatusId
        })

        const afterCreateRepliesCount = await database.getStatusRepliesCount({
          statusId: parentStatusId
        })
        expect(afterCreateRepliesCount).toBe(beforeRepliesCount + 1)

        await database.deleteStatus({ statusId: replyStatusId })

        const afterDeleteRepliesCount = await database.getStatusRepliesCount({
          statusId: parentStatusId
        })
        expect(afterDeleteRepliesCount).toBe(beforeRepliesCount)
      })

      it('decreases reblog counter when deleting an announce', async () => {
        const originalStatusId = statuses.primary.post
        const announceId = `${extraActorId}/statuses/reblog-counter-delete-test`

        const beforeReblogsCount = await database.getStatusReblogsCount({
          statusId: originalStatusId
        })

        await database.createAnnounce({
          id: announceId,
          actorId: extraActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId
        })

        const afterCreateReblogsCount = await database.getStatusReblogsCount({
          statusId: originalStatusId
        })
        expect(afterCreateReblogsCount).toBe(beforeReblogsCount + 1)

        await database.deleteStatus({ statusId: announceId })

        const afterDeleteReblogsCount = await database.getStatusReblogsCount({
          statusId: originalStatusId
        })
        expect(afterDeleteReblogsCount).toBe(beforeReblogsCount)
      })
    })

    describe('getHashtagStatusesPage', () => {
      const tag = `pagetag_${Date.now()}`

      beforeAll(async () => {
        // Create 3 public posts with the tag and 1 non-public post
        for (let i = 1; i <= 3; i++) {
          const id = `${primaryActorId}/statuses/page-hashtag-${tag}-${i}`
          await database.createNote({
            id,
            url: id,
            actorId: primaryActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: `Post #${tag} number ${i}`
          })
          await database.createTag({
            statusId: id,
            name: `#${tag}`,
            value: `https://${actors.primary.domain}/tags/${tag}`,
            type: 'hashtag'
          })
        }
        // Non-public post (followers-only) — should not appear
        const privateId = `${primaryActorId}/statuses/page-hashtag-${tag}-private`
        await database.createNote({
          id: privateId,
          url: privateId,
          actorId: primaryActorId,
          to: [`${primaryActorId}/followers`],
          cc: [],
          text: `Private post #${tag}`
        })
        await database.createTag({
          statusId: privateId,
          name: `#${tag}`,
          value: `https://${actors.primary.domain}/tags/${tag}`,
          type: 'hashtag'
        })
      })

      it('returns paginated public statuses for a hashtag', async () => {
        const { statuses: page1, total } =
          await database.getHashtagStatusesPage({
            hashtag: tag,
            limit: 2,
            offset: 0
          })
        expect(total).toBe(3)
        expect(page1).toHaveLength(2)
      })

      it('respects limit and offset', async () => {
        const { statuses: page2 } = await database.getHashtagStatusesPage({
          hashtag: tag,
          limit: 2,
          offset: 2
        })
        expect(page2).toHaveLength(1)
      })

      it('orders results newest first', async () => {
        const { statuses } = await database.getHashtagStatusesPage({
          hashtag: tag,
          limit: 10,
          offset: 0
        })
        const times = statuses.map((s) => s.createdAt as number)
        expect(times).toEqual([...times].sort((a, b) => b - a))
      })

      it('excludes non-public posts from results and total', async () => {
        const { statuses, total } = await database.getHashtagStatusesPage({
          hashtag: tag,
          limit: 10,
          offset: 0
        })
        expect(total).toBe(3)
        const texts = statuses.map((s) => (s as { text?: string }).text ?? '')
        expect(texts.some((t) => t.includes('Private'))).toBe(false)
      })

      it('handles a # prefix in the hashtag argument', async () => {
        const { statuses } = await database.getHashtagStatusesPage({
          hashtag: `#${tag}`,
          limit: 10,
          offset: 0
        })
        expect(statuses.length).toBe(3)
      })

      it('returns empty results and zero total for unknown hashtag', async () => {
        const { statuses, total } = await database.getHashtagStatusesPage({
          hashtag: 'totally_unknown_tag_xyz',
          limit: 10,
          offset: 0
        })
        expect(statuses).toHaveLength(0)
        expect(total).toBe(0)
      })
    })
  })
})
