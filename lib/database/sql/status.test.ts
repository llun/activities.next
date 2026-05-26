import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import { SQLITE_MAX_BINDINGS } from '@/lib/database/sql/utils/knex'
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
import {
  StatusAnnounce,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { TagType } from '@/lib/types/domain/tag'
import { normalizeActorId } from '@/lib/utils/activitypub'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
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

    it('stores reply hashes for created replies', async () => {
      const knexDatabase = knex({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: {
          filename: ':memory:'
        }
      })
      const sqlDatabase = getSQLDatabase(knexDatabase)

      try {
        await sqlDatabase.migrate()

        const reply = 'https://remote.test/users/alice/statuses/1'
        const noteId = `${replyAuthorId}/statuses/reply-hash-note`
        const pollId = `${replyAuthorId}/statuses/reply-hash-poll`

        await sqlDatabase.createNote({
          id: noteId,
          url: noteId,
          actorId: replyAuthorId,
          text: 'Reply hash note',
          to: [],
          cc: [],
          reply
        })
        await sqlDatabase.createPoll({
          id: pollId,
          url: pollId,
          actorId: replyAuthorId,
          text: 'Reply hash poll',
          to: [],
          cc: [],
          reply,
          choices: ['Yes', 'No'],
          endAt: Date.now()
        })

        await expect(
          knexDatabase('statuses')
            .whereIn('id', [noteId, pollId])
            .select('id', 'replyHash')
            .orderBy('id', 'asc')
        ).resolves.toEqual([
          { id: noteId, replyHash: getHashFromString(reply) },
          { id: pollId, replyHash: getHashFromString(reply) }
        ])
      } finally {
        await knexDatabase.destroy()
      }
    })

    it('uses reply hashes for recipientless parent URL visibility lookups', async () => {
      const knexDatabase = knex({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: {
          filename: ':memory:'
        }
      })
      const sqlDatabase = getSQLDatabase(knexDatabase)

      try {
        await sqlDatabase.migrate()

        const visibleActorId = 'https://local.test/users/visible'
        const replyActorId = 'https://remote.test/users/reply'
        const parentStatusId = `${visibleActorId}/statuses/reply-hash-parent`
        const parentStatusUrl = `${parentStatusId}/canonical`
        const replyStatusId = `${replyActorId}/statuses/reply-hash-child`

        const parent = await sqlDatabase.createNote({
          id: parentStatusId,
          url: parentStatusUrl,
          actorId: visibleActorId,
          text: 'Reply hash parent',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          reply: ''
        })
        await sqlDatabase.createNote({
          id: replyStatusId,
          url: replyStatusId,
          actorId: replyActorId,
          text: 'Reply hash child',
          to: [],
          cc: [],
          reply: parent.url
        })
        await knexDatabase('statuses')
          .where('id', replyStatusId)
          .update({ replyHash: null })

        const results = await sqlDatabase.getStatusesByIds({
          statusIds: [replyStatusId],
          visibleToActorId: visibleActorId
        })

        expect(results).toEqual([])
      } finally {
        await knexDatabase.destroy()
      }
    })

    it('includes publicly readable legacy Announces that only store the target in content', async () => {
      const knexDatabase = knex({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: {
          filename: ':memory:'
        }
      })
      const sqlDatabase = getSQLDatabase(knexDatabase)

      try {
        await sqlDatabase.migrate()
        await seedDatabase(sqlDatabase)

        const statusId = `${primaryActorId}/statuses/legacy-reblog-target`
        await sqlDatabase.createNote({
          id: statusId,
          url: statusId,
          actorId: primaryActorId,
          text: 'Public target for legacy reblog',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })

        const legacyAnnounceId = `${replyAuthorId}/statuses/legacy-reblog`
        const createdAt = new Date('2024-04-01T00:00:00.000Z')
        await knexDatabase('statuses').insert({
          id: legacyAnnounceId,
          url: null,
          urlHash: null,
          actorId: replyAuthorId,
          type: StatusType.enum.Announce,
          reply: '',
          content: statusId,
          originalStatusId: null,
          createdAt,
          updatedAt: createdAt
        })
        await knexDatabase('recipients').insert({
          id: crypto.randomUUID(),
          statusId: legacyAnnounceId,
          actorId: ACTIVITY_STREAM_PUBLIC,
          type: 'to',
          createdAt,
          updatedAt: createdAt
        })

        await expect(
          sqlDatabase.getRebloggedBy({
            statusId,
            limit: 40,
            visibleToActorId: null
          })
        ).resolves.toEqual([
          {
            actorId: replyAuthorId,
            statusId: legacyAnnounceId
          }
        ])
      } finally {
        await knexDatabase.destroy()
      }
    })
  })

  describe('potentially readable status SQL', () => {
    it('quotes camelCase identifiers in PostgreSQL follower audience checks', async () => {
      const postgresDatabase = knex({ client: 'pg' })
      const sqlDatabase = getSQLDatabase(postgresDatabase)
      const queries: string[] = []
      const onQuery = (query: { sql: string }) => queries.push(query.sql)

      postgresDatabase.on('query', onQuery)
      postgresDatabase.client.acquireConnection = jest.fn().mockResolvedValue({
        query: jest.fn((_queryConfig, callback) => {
          callback(null, { command: 'SELECT', rows: [] })
        })
      })
      postgresDatabase.client.releaseConnection = jest.fn()

      try {
        await sqlDatabase.getStatusesByIds({
          statusIds: [`${primaryActorId}/statuses/postgres-readable`],
          visibleToActorId: replyAuthorId
        })

        expect(queries[0]).toContain(
          '"followers_recipients"."statusId" = "statuses"."id"'
        )
        expect(queries[0]).toContain(
          '"followers_recipients"."actorId" = status_actors.settings::jsonb ->> \'followersUrl\''
        )
        expect(queries[0]).toContain(
          '"followers_recipients"."actorId" = "statuses"."actorId" || \'/followers\''
        )
        expect(queries[0]).toContain(
          '"follows"."targetActorId" = "statuses"."actorId"'
        )
      } finally {
        postgresDatabase.off('query', onQuery)
        await postgresDatabase.destroy()
      }
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
          isActorBookmarked: false,
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

    describe('getStatusesByIds', () => {
      const createVisibilityActor = async ({
        name,
        suffix,
        local = false
      }: {
        name: string
        suffix: string
        local?: boolean
      }) => {
        const actorId = `https://status-visibility.test/users/${name}-${suffix}`
        await database.createActor({
          actorId,
          username: `${name}-${suffix}`,
          domain: 'status-visibility.test',
          followersUrl: `${actorId}/followers`,
          inboxUrl: `${actorId}/inbox`,
          sharedInboxUrl: 'https://status-visibility.test/inbox',
          publicKey: `public-key-${name}-${suffix}`,
          privateKey: local ? `private-key-${name}-${suffix}` : undefined,
          createdAt: Date.now()
        })
        return actorId
      }

      it('hydrates actor flags for the current actor', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const bookmarkedStatusId = `${emptyActorId}/statuses/bookmarked-${suffix}`
        const unbookmarkedStatusId = `${emptyActorId}/statuses/unbookmarked-${suffix}`

        await database.createNote({
          id: bookmarkedStatusId,
          url: bookmarkedStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Bookmarked status'
        })
        await database.createNote({
          id: unbookmarkedStatusId,
          url: unbookmarkedStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Unbookmarked status'
        })
        await database.createBookmark({
          actorId: primaryActorId,
          statusId: bookmarkedStatusId
        })
        await database.createLike({
          actorId: primaryActorId,
          statusId: unbookmarkedStatusId
        })

        const results = await database.getStatusesByIds({
          statusIds: [unbookmarkedStatusId, bookmarkedStatusId],
          currentActorId: primaryActorId
        })

        expect(results.map((status) => status.id)).toEqual([
          unbookmarkedStatusId,
          bookmarkedStatusId
        ])
        expect((results[0] as StatusNote).isActorBookmarked).toBe(false)
        expect((results[0] as StatusNote).isActorLiked).toBe(true)
        expect((results[1] as StatusNote).isActorBookmarked).toBe(true)
        expect((results[1] as StatusNote).isActorLiked).toBe(false)
      })

      it('hydrates actor flags for nested announce originals', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const originalActorId = `${emptyActorId}/announce-original-${suffix}`
        const firstAnnounceActorId = `${replyAuthorId}/announce-first-${suffix}`
        const secondAnnounceActorId = `${extraActorId}/announce-second-${suffix}`
        const originalStatusId = `${originalActorId}/statuses/original`
        const firstAnnounceId = `${firstAnnounceActorId}/statuses/first`
        const secondAnnounceId = `${secondAnnounceActorId}/statuses/second`

        await database.createNote({
          id: originalStatusId,
          url: originalStatusId,
          actorId: originalActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Nested announce original'
        })
        await database.createAnnounce({
          id: firstAnnounceId,
          actorId: firstAnnounceActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId
        })
        await database.createAnnounce({
          id: secondAnnounceId,
          actorId: secondAnnounceActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: firstAnnounceId
        })
        await database.createBookmark({
          actorId: primaryActorId,
          statusId: secondAnnounceId
        })
        await database.createLike({
          actorId: primaryActorId,
          statusId: originalStatusId
        })

        const results = await database.getStatusesByIds({
          statusIds: [secondAnnounceId],
          currentActorId: primaryActorId
        })

        expect(results).toHaveLength(1)
        const secondAnnounce = results[0] as StatusAnnounce
        expect(secondAnnounce.type).toBe(StatusType.enum.Announce)
        const firstAnnounce = secondAnnounce.originalStatus as StatusAnnounce
        expect(firstAnnounce.type).toBe(StatusType.enum.Announce)
        const originalStatus = firstAnnounce.originalStatus as StatusNote
        expect(originalStatus.id).toBe(originalStatusId)
        expect(originalStatus.isActorBookmarked).toBe(true)
        expect(originalStatus.isActorLiked).toBe(true)
      })

      it('filters statuses by visible actor while preserving requested order', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const hiddenStatusId = `${emptyActorId}/statuses/hidden-${suffix}`
        const directStatusId = `${emptyActorId}/statuses/direct-${suffix}`
        const publicStatusId = `${emptyActorId}/statuses/public-${suffix}`

        await database.createNote({
          id: hiddenStatusId,
          url: hiddenStatusId,
          actorId: emptyActorId,
          to: [extraActorId],
          cc: [],
          text: 'Hidden status'
        })
        await database.createNote({
          id: directStatusId,
          url: directStatusId,
          actorId: emptyActorId,
          to: [primaryActorId],
          cc: [],
          text: 'Direct status'
        })
        await database.createNote({
          id: publicStatusId,
          url: publicStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Public status'
        })

        const results = await database.getStatusesByIds({
          statusIds: [hiddenStatusId, directStatusId, publicStatusId],
          visibleToActorId: primaryActorId
        })

        expect(results.map((status) => status.id)).toEqual([
          directStatusId,
          publicStatusId
        ])
      })

      it('includes recipientless replies to statuses authored by the visible actor', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const visibleActorId = await createVisibilityActor({
          name: 'visible-parent',
          suffix
        })
        const replyActorId = await createVisibilityActor({
          name: 'visible-reply',
          suffix
        })
        const parentStatusId = `${visibleActorId}/statuses/recipientless-visible-parent`
        const replyStatusId = `${replyActorId}/statuses/recipientless-visible-reply`

        const parent = await database.createNote({
          id: parentStatusId,
          url: `${parentStatusId}/canonical`,
          actorId: visibleActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${visibleActorId}/followers`],
          text: 'Recipientless reply parent'
        })
        await database.createNote({
          id: replyStatusId,
          url: replyStatusId,
          actorId: replyActorId,
          to: [],
          cc: [],
          reply: parent.url,
          text: 'Recipientless reply to visible actor'
        })

        const results = await database.getStatusesByIds({
          statusIds: [replyStatusId],
          visibleToActorId: visibleActorId
        })

        expect(results.map((status) => status.id)).toEqual([replyStatusId])
      })

      it('includes recipientless replies for inherited direct conversation participants', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const rootActorId = await createVisibilityActor({
          name: 'dm-root',
          suffix,
          local: true
        })
        const replyActorId = await createVisibilityActor({
          name: 'dm-reply',
          suffix,
          local: true
        })
        const participantActorId = await createVisibilityActor({
          name: 'dm-participant',
          suffix,
          local: true
        })
        const rootStatusId = `${rootActorId}/statuses/recipientless-dm-root`
        const replyStatusId = `${replyActorId}/statuses/recipientless-dm-reply`

        const root = await database.createNote({
          id: rootStatusId,
          url: `${rootStatusId}/canonical`,
          actorId: rootActorId,
          to: [replyActorId, participantActorId],
          cc: [],
          text: 'Direct conversation root'
        })
        await database.syncDirectConversationForStatus({ status: root })
        await database.createNote({
          id: replyStatusId,
          url: replyStatusId,
          actorId: replyActorId,
          to: [],
          cc: [],
          reply: root.url,
          text: 'Recipientless reply in synced direct conversation'
        })

        const results = await database.getStatusesByIds({
          statusIds: [replyStatusId],
          visibleToActorId: participantActorId
        })

        expect(results.map((status) => status.id)).toEqual([replyStatusId])
      })

      it('excludes recipientless replies for unrelated visible actors', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const parentActorId = await createVisibilityActor({
          name: 'hidden-parent',
          suffix
        })
        const replyActorId = await createVisibilityActor({
          name: 'hidden-reply',
          suffix
        })
        const visibleActorId = await createVisibilityActor({
          name: 'unrelated-visible',
          suffix
        })
        const parentStatusId = `${parentActorId}/statuses/recipientless-hidden-parent`
        const replyStatusId = `${replyActorId}/statuses/recipientless-hidden-reply`

        const parent = await database.createNote({
          id: parentStatusId,
          url: parentStatusId,
          actorId: parentActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Unrelated recipientless parent'
        })
        await database.createNote({
          id: replyStatusId,
          url: replyStatusId,
          actorId: replyActorId,
          to: [],
          cc: [],
          reply: parent.id,
          text: 'Recipientless reply hidden from unrelated actors'
        })

        const results = await database.getStatusesByIds({
          statusIds: [replyStatusId],
          visibleToActorId: visibleActorId
        })

        expect(results).toEqual([])
      })

      it('includes followers-only statuses from followed actors when filtering by visible actor', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const followerActorId = `${emptyActorId}/followers-only-follower-${suffix}`
        const followedActorId = `${emptyActorId}/followers-only-followed-${suffix}`
        const followersUrl = `${followedActorId}/followers`
        const statusId = `${followedActorId}/statuses/followers-only-${suffix}`

        await database.createActor({
          actorId: followerActorId,
          username: `followers-only-follower-${suffix}`,
          domain: 'remote.test',
          followersUrl: `${followerActorId}/followers`,
          inboxUrl: `${followerActorId}/inbox`,
          sharedInboxUrl: 'https://remote.test/inbox',
          publicKey: `follower-public-key-${suffix}`,
          createdAt: Date.now()
        })
        await database.createActor({
          actorId: followedActorId,
          username: `followers-only-followed-${suffix}`,
          domain: 'remote.test',
          followersUrl,
          inboxUrl: `${followedActorId}/inbox`,
          sharedInboxUrl: 'https://remote.test/inbox',
          publicKey: `followed-public-key-${suffix}`,
          createdAt: Date.now()
        })
        await database.createFollow({
          actorId: followerActorId,
          targetActorId: followedActorId,
          inbox: `${followerActorId}/inbox`,
          sharedInbox: `${followerActorId}/inbox`,
          status: FollowStatus.enum.Accepted
        })
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: followedActorId,
          to: [followersUrl],
          cc: [],
          text: 'Followers-only status from followed actor'
        })

        const results = await database.getStatusesByIds({
          statusIds: [statusId],
          visibleToActorId: followerActorId
        })

        expect(results.map((status) => status.id)).toEqual([statusId])
      })
    })

    describe('getActorStatuses', () => {
      const createStatusFilterActor = async (suffix: string) => {
        const actorId = `https://status-filter.test/users/${suffix}`
        await database.createActor({
          actorId,
          username: suffix,
          domain: 'status-filter.test',
          followersUrl: `${actorId}/followers`,
          inboxUrl: `${actorId}/inbox`,
          sharedInboxUrl: 'https://status-filter.test/inbox',
          publicKey: `public-key-${suffix}`,
          createdAt: Date.now()
        })
        return actorId
      }

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

      it('filters media statuses before applying the result limit', async () => {
        const suffix = `only-media-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const actorId = await createStatusFilterActor(suffix)
        const createdAt = Date.UTC(2035, 1, 1)
        const mediaStatusId = `${actorId}/statuses/media`
        const textStatusId = `${actorId}/statuses/text`

        await database.createNote({
          id: mediaStatusId,
          url: mediaStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Media status',
          createdAt
        })
        await database.createAttachment({
          actorId,
          statusId: mediaStatusId,
          mediaType: 'image/png',
          url: `${mediaStatusId}/image.png`
        })
        await database.createNote({
          id: textStatusId,
          url: textStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Text status',
          createdAt: createdAt + 1
        })

        const statuses = await database.getActorStatuses({
          actorId,
          limit: 1,
          onlyMedia: true
        })

        expect(statuses.map((status) => status.id)).toEqual([mediaStatusId])
      })

      it('excludes replies to other actors and missing parents while keeping self-replies', async () => {
        const suffix = `exclude-replies-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const actorId = await createStatusFilterActor(suffix)
        const otherActorId = await createStatusFilterActor(`${suffix}-other`)
        const createdAt = Date.UTC(2035, 2, 1)
        const parentStatusId = `${actorId}/statuses/parent`
        const selfReplyStatusId = `${actorId}/statuses/self-reply`
        const urlParentStatusId = `${actorId}/statuses/url-parent`
        const urlParentStatusUrl = `${actorId}/@status/url-parent`
        const selfReplyByUrlStatusId = `${actorId}/statuses/self-reply-by-url`
        const otherParentStatusId = `${otherActorId}/statuses/parent`
        const otherReplyStatusId = `${actorId}/statuses/other-reply`
        const missingReplyStatusId = `${actorId}/statuses/missing-reply`

        await database.createNote({
          id: parentStatusId,
          url: parentStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Reply parent',
          createdAt
        })
        await database.createNote({
          id: selfReplyStatusId,
          url: selfReplyStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Self reply',
          reply: parentStatusId,
          createdAt: createdAt + 1
        })
        await database.createNote({
          id: urlParentStatusId,
          url: urlParentStatusUrl,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Reply parent with distinct URL',
          createdAt: createdAt + 2
        })
        await database.createNote({
          id: selfReplyByUrlStatusId,
          url: selfReplyByUrlStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Self reply by URL',
          reply: urlParentStatusUrl,
          createdAt: createdAt + 3
        })
        await database.createNote({
          id: otherParentStatusId,
          url: otherParentStatusId,
          actorId: otherActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Other parent',
          createdAt: createdAt + 4
        })
        await database.createNote({
          id: otherReplyStatusId,
          url: otherReplyStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Other reply',
          reply: otherParentStatusId,
          createdAt: createdAt + 5
        })
        await database.createNote({
          id: missingReplyStatusId,
          url: missingReplyStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Missing reply',
          reply: `${otherActorId}/statuses/missing`,
          createdAt: createdAt + 6
        })

        const statuses = await database.getActorStatuses({
          actorId,
          limit: 10,
          excludeReplies: true
        })
        const statusIds = statuses.map((status) => status.id)

        expect(statusIds).toContain(parentStatusId)
        expect(statusIds).toContain(selfReplyStatusId)
        expect(statusIds).toContain(selfReplyByUrlStatusId)
        expect(statusIds).not.toContain(otherReplyStatusId)
        expect(statusIds).not.toContain(missingReplyStatusId)
      })

      it('excludes reblogs before applying the result limit', async () => {
        const suffix = `exclude-reblogs-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const actorId = await createStatusFilterActor(suffix)
        const otherActorId = await createStatusFilterActor(`${suffix}-other`)
        const createdAt = Date.UTC(2035, 3, 1)
        const originalStatusId = `${otherActorId}/statuses/original`
        const noteStatusId = `${actorId}/statuses/note`
        const announceStatusId = `${actorId}/statuses/announce`

        await database.createNote({
          id: originalStatusId,
          url: originalStatusId,
          actorId: otherActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Original status',
          createdAt
        })
        await database.createNote({
          id: noteStatusId,
          url: noteStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Own note status',
          createdAt: createdAt + 1
        })
        await database.createAnnounce({
          id: announceStatusId,
          actorId,
          originalStatusId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          createdAt: createdAt + 2
        })

        const statuses = await database.getActorStatuses({
          actorId,
          limit: 1,
          excludeReblogs: true
        })

        expect(statuses.map((status) => status.id)).toEqual([noteStatusId])
      })

      it('filters statuses by normalized hashtag before applying the result limit', async () => {
        const suffix = `tagged-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const actorId = await createStatusFilterActor(suffix)
        const createdAt = Date.UTC(2035, 4, 1)
        const taggedStatusId = `${actorId}/statuses/running`
        const untaggedStatusId = `${actorId}/statuses/cycling`

        await database.createNote({
          id: taggedStatusId,
          url: taggedStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Tagged #Running status',
          createdAt
        })
        await database.createTag({
          statusId: taggedStatusId,
          name: '#Running',
          value: 'https://status-filter.test/tags/running',
          type: 'hashtag'
        })
        await database.createNote({
          id: untaggedStatusId,
          url: untaggedStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Tagged #Cycling status',
          createdAt: createdAt + 1
        })
        await database.createTag({
          statusId: untaggedStatusId,
          name: '#Cycling',
          value: 'https://status-filter.test/tags/cycling',
          type: 'hashtag'
        })

        const statuses = await database.getActorStatuses({
          actorId,
          limit: 1,
          tagged: 'running'
        })

        expect(statuses.map((status) => status.id)).toEqual([taggedStatusId])
      })

      it('filters pinned statuses for the requested actor before applying the result limit', async () => {
        const suffix = `pinned-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const actorId = await createStatusFilterActor(suffix)
        const createdAt = Date.UTC(2035, 5, 1)
        const pinnedStatusId = `${actorId}/statuses/pinned`
        const unpinnedStatusId = `${actorId}/statuses/unpinned`

        await database.createNote({
          id: pinnedStatusId,
          url: pinnedStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Pinned status',
          createdAt
        })
        await database.createNote({
          id: unpinnedStatusId,
          url: unpinnedStatusId,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Unpinned status',
          createdAt: createdAt + 1
        })
        await database.pinStatus({
          actorId,
          statusId: pinnedStatusId
        })

        const statuses = await database.getActorStatuses({
          actorId,
          limit: 1,
          pinned: true
        })

        expect(statuses.map((status) => status.id)).toEqual([pinnedStatusId])
      })

      it('enforces a max pinned status count inside pinStatus', async () => {
        const suffix = `pin-limit-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const actorId = await createStatusFilterActor(suffix)
        const firstStatusId = `${actorId}/statuses/first-pin`
        const secondStatusId = `${actorId}/statuses/second-pin`

        for (const statusId of [firstStatusId, secondStatusId]) {
          await database.createNote({
            id: statusId,
            url: statusId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Pin limit status'
          })
        }
        await expect(
          database.pinStatus({
            actorId,
            statusId: firstStatusId,
            maxPinnedStatuses: 1
          })
        ).resolves.toBe(true)
        await expect(
          database.pinStatus({
            actorId,
            statusId: secondStatusId,
            maxPinnedStatuses: 1
          })
        ).resolves.toBe(false)
        await expect(
          database.pinStatus({
            actorId,
            statusId: firstStatusId,
            maxPinnedStatuses: 1
          })
        ).resolves.toBe(true)

        await expect(database.getPinnedStatusIds({ actorId })).resolves.toEqual(
          [firstStatusId]
        )
      })

      it('keeps cursor pagination stable when filters match statuses with the same timestamp', async () => {
        const suffix = `cursor-filters-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const actorId = await createStatusFilterActor(suffix)
        const createdAt = Date.UTC(2035, 6, 1)
        const firstStatusId = `${actorId}/statuses/z-running`
        const secondStatusId = `${actorId}/statuses/y-running`
        const thirdStatusId = `${actorId}/statuses/x-running`

        for (const statusId of [firstStatusId, secondStatusId, thirdStatusId]) {
          await database.createNote({
            id: statusId,
            url: statusId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Cursor filtered #running status',
            createdAt
          })
          await database.createTag({
            statusId,
            name: '#running',
            value: 'https://status-filter.test/tags/running',
            type: 'hashtag'
          })
        }

        const firstPage = await database.getActorStatuses({
          actorId,
          tagged: 'running',
          limit: 2
        })
        const secondPage = await database.getActorStatuses({
          actorId,
          tagged: 'running',
          maxStatusId: secondStatusId,
          limit: 2
        })

        expect(firstPage.map((status) => status.id)).toEqual([
          firstStatusId,
          secondStatusId
        ])
        expect(secondPage.map((status) => status.id)).toEqual([thirdStatusId])
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

    describe('getActorAnnouncedStatusId', () => {
      it('returns the actor announce id for an original status', async () => {
        const announceId = await database.getActorAnnouncedStatusId({
          originalStatusId: statuses.primary.postWithAttachments,
          actorId: replyAuthorId
        })

        expect(announceId).toBe(statuses.replyAuthor.announcePrimary)
      })

      it('returns null when the actor has not announced the status', async () => {
        const announceId = await database.getActorAnnouncedStatusId({
          originalStatusId: statuses.primary.postWithAttachments,
          actorId: primaryActorId
        })

        expect(announceId).toBeNull()
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

      it('returns reblog counts for multiple statuses', async () => {
        const counts = await database.getStatusReblogsCounts({
          statusIds: [
            statuses.primary.postWithAttachments,
            statuses.primary.post
          ]
        })
        expect(counts).toEqual({
          [statuses.primary.postWithAttachments]: 1,
          [statuses.primary.post]: 0
        })
      })

      it('returns bulk reblog counts in SQLite-safe batches', async () => {
        const statusIds = Array.from(
          { length: 1005 },
          (_, index) => `${emptyActorId}/statuses/bulk-reblog-count-${index}`
        )
        const counts = await database.getStatusReblogsCounts({ statusIds })

        expect(Object.keys(counts)).toHaveLength(statusIds.length)
        expect(Object.values(counts).every((count) => count === 0)).toBe(true)
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

      it('returns reply counts for multiple statuses', async () => {
        const counts = await database.getStatusRepliesCounts({
          statusIds: [statuses.primary.post, statuses.primary.secondPost]
        })
        expect(counts).toEqual({
          [statuses.primary.post]: 2,
          [statuses.primary.secondPost]: 0
        })
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

      it('returns actor poll votes for multiple statuses', async () => {
        const firstPollId = `${emptyActorId}/statuses/poll-votes-bulk-1`
        const secondPollId = `${emptyActorId}/statuses/poll-votes-bulk-2`
        const thirdPollId = `${emptyActorId}/statuses/poll-votes-bulk-3`
        const voterId = `${replyAuthorId}/poll-votes-bulk`

        for (const pollId of [firstPollId, secondPollId, thirdPollId]) {
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
        }

        await database.recordPollVotes({
          statusId: firstPollId,
          actorId: voterId,
          choices: [1, 0]
        })
        await database.recordPollVotes({
          statusId: secondPollId,
          actorId: voterId,
          choices: [1]
        })

        await expect(
          database.getActorPollVotesForStatuses({
            statusIds: [firstPollId, secondPollId, thirdPollId, firstPollId],
            actorId: voterId
          })
        ).resolves.toEqual({
          [firstPollId]: [0, 1],
          [secondPollId]: [1],
          [thirdPollId]: []
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

      it('returns compact public statuses with a given hashtag', async () => {
        const statusId = `${primaryActorId}/statuses/compact-hashtag-test-${Date.now()}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC_COMPACT],
          cc: [],
          text: 'Hello #compacttesting'
        })
        await database.createTag({
          statusId,
          name: '#compacttesting',
          value: `https://${actors.primary.domain}/tags/compacttesting`,
          type: 'hashtag'
        })

        const results = await database.getStatusesByHashtag({
          hashtag: 'compacttesting'
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

      it('normalizes repeated hashtag prefixes for counters', async () => {
        const tag = `RepeatedPrefix_${Date.now()}`

        await database.increaseHashtagCounter({ hashtag: `##${tag}` })

        await expect(
          database.getHashtagCounter({ hashtag: tag.toLowerCase() })
        ).resolves.toBe(1)

        await database.decreaseHashtagCounter({ hashtag: `#${tag}` })

        await expect(
          database.getHashtagCounter({ hashtag: `##${tag.toUpperCase()}` })
        ).resolves.toBe(0)
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

      it('deletes pinned status rows for deleted statuses', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const statusId = `${primaryActorId}/statuses/delete-pinned-${suffix}`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Delete pinned status'
        })
        await database.pinStatus({ actorId: primaryActorId, statusId })

        expect(
          await database.getPinnedStatusIds({
            actorId: primaryActorId,
            statusIds: [statusId]
          })
        ).toEqual([statusId])

        await database.deleteStatus({ statusId })

        expect(
          await database.getPinnedStatusIds({
            actorId: primaryActorId,
            statusIds: [statusId]
          })
        ).toEqual([])
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

      it('keeps replies owned by other actors when deleting with an actor scope', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const parentStatusId = `${primaryActorId}/statuses/scoped-delete-parent-${suffix}`
        const otherReplyStatusId = `${extraActorId}/statuses/scoped-delete-reply-${suffix}`

        await database.createNote({
          id: parentStatusId,
          url: parentStatusId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Scoped delete parent'
        })
        await database.createNote({
          id: otherReplyStatusId,
          url: otherReplyStatusId,
          actorId: extraActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Reply owned by another actor',
          reply: parentStatusId
        })

        await database.deleteStatus({
          statusId: parentStatusId,
          actorId: primaryActorId
        })

        expect(
          await database.getStatus({ statusId: parentStatusId })
        ).toBeNull()
        expect(
          await database.getStatus({ statusId: otherReplyStatusId })
        ).not.toBeNull()
      })

      it('traverses other actor replies when collecting actor-scoped deletes', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const parentStatusId = `${primaryActorId}/statuses/scoped-delete-parent-chain-${suffix}`
        const otherReplyStatusId = `${extraActorId}/statuses/scoped-delete-other-reply-${suffix}`
        const ownedNestedReplyStatusId = `${primaryActorId}/statuses/scoped-delete-owned-nested-${suffix}`

        await database.createNote({
          id: parentStatusId,
          url: parentStatusId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Scoped delete parent with mixed reply tree'
        })
        await database.createNote({
          id: otherReplyStatusId,
          url: otherReplyStatusId,
          actorId: extraActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Reply owned by another actor',
          reply: parentStatusId
        })
        await database.createNote({
          id: ownedNestedReplyStatusId,
          url: ownedNestedReplyStatusId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Nested reply owned by scoped actor',
          reply: otherReplyStatusId
        })

        await database.deleteStatus({
          statusId: parentStatusId,
          actorId: primaryActorId
        })

        expect(
          await database.getStatus({ statusId: parentStatusId })
        ).toBeNull()
        expect(
          await database.getStatus({ statusId: otherReplyStatusId })
        ).not.toBeNull()
        expect(
          await database.getStatus({ statusId: ownedNestedReplyStatusId })
        ).toBeNull()
      })

      it('deletes likes for deleted statuses', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const statusId = `${primaryActorId}/statuses/delete-liked-status-${suffix}`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Liked status that will be deleted'
        })
        await database.createLike({ actorId: extraActorId, statusId })

        await expect(
          database.isActorLikedStatus({ actorId: extraActorId, statusId })
        ).resolves.toBe(true)

        await database.deleteStatus({ statusId })

        await expect(
          database.isActorLikedStatus({ actorId: extraActorId, statusId })
        ).resolves.toBe(false)
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
        const knexDatabase = knex({
          client: 'better-sqlite3',
          useNullAsDefault: true,
          connection: {
            filename: ':memory:'
          }
        })
        const sqlDatabase = getSQLDatabase(knexDatabase)
        const originalActorId = 'https://remote.test/users/reblog-original'
        const reblogActorId = 'https://remote.test/users/reblog-deleter'
        const originalStatusId = `${originalActorId}/statuses/original`
        const announceId = `${reblogActorId}/statuses/reblog-counter-delete-test`

        try {
          await sqlDatabase.migrate()
          await sqlDatabase.createActor({
            actorId: originalActorId,
            username: 'reblog-original',
            domain: 'remote.test',
            followersUrl: `${originalActorId}/followers`,
            inboxUrl: `${originalActorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            publicKey: 'public-key',
            createdAt: Date.now()
          })
          await sqlDatabase.createActor({
            actorId: reblogActorId,
            username: 'reblog-deleter',
            domain: 'remote.test',
            followersUrl: `${reblogActorId}/followers`,
            inboxUrl: `${reblogActorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            publicKey: 'public-key',
            createdAt: Date.now()
          })
          await sqlDatabase.createNote({
            id: originalStatusId,
            url: originalStatusId,
            actorId: originalActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Original status'
          })

          const beforeReblogsCount = await sqlDatabase.getStatusReblogsCount({
            statusId: originalStatusId
          })

          await sqlDatabase.createAnnounce({
            id: announceId,
            actorId: reblogActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            originalStatusId
          })
          await knexDatabase('statuses')
            .where('id', announceId)
            .update({ content: JSON.stringify({}) })

          const afterCreateReblogsCount =
            await sqlDatabase.getStatusReblogsCount({
              statusId: originalStatusId
            })
          expect(afterCreateReblogsCount).toBe(beforeReblogsCount + 1)

          await sqlDatabase.deleteStatus({ statusId: announceId })

          const afterDeleteReblogsCount =
            await sqlDatabase.getStatusReblogsCount({
              statusId: originalStatusId
            })
          expect(afterDeleteReblogsCount).toBe(beforeReblogsCount)
        } finally {
          await knexDatabase.destroy()
        }
      })

      it('deletes reply cycles without unbounded recursion', async () => {
        const knexDatabase = knex({
          client: 'better-sqlite3',
          useNullAsDefault: true,
          connection: {
            filename: ':memory:'
          }
        })
        const sqlDatabase = getSQLDatabase(knexDatabase)
        const actorId = 'https://remote.test/users/reply-cycle'
        const firstStatusId = `${actorId}/statuses/cycle-a`
        const secondStatusId = `${actorId}/statuses/cycle-b`

        try {
          await sqlDatabase.migrate()
          await sqlDatabase.createActor({
            actorId,
            username: 'reply-cycle',
            domain: 'remote.test',
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            publicKey: 'public-key',
            createdAt: Date.now()
          })
          await sqlDatabase.createNote({
            id: firstStatusId,
            url: firstStatusId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Reply cycle A'
          })
          await sqlDatabase.createNote({
            id: secondStatusId,
            url: secondStatusId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Reply cycle B',
            reply: firstStatusId
          })
          await knexDatabase('statuses')
            .where('id', firstStatusId)
            .update({
              reply: secondStatusId,
              replyHash: getHashFromString(secondStatusId)
            })

          await expect(
            sqlDatabase.deleteStatus({ statusId: firstStatusId })
          ).resolves.toBeUndefined()
          await expect(
            sqlDatabase.getStatus({ statusId: firstStatusId })
          ).resolves.toBeNull()
          await expect(
            sqlDatabase.getStatus({ statusId: secondStatusId })
          ).resolves.toBeNull()
        } finally {
          await knexDatabase.destroy()
        }
      })

      it('rejects very deep reply trees before building a long delete transaction', async () => {
        const knexDatabase = knex({
          client: 'better-sqlite3',
          useNullAsDefault: true,
          connection: {
            filename: ':memory:'
          }
        })
        const sqlDatabase = getSQLDatabase(knexDatabase)
        const actorId = 'https://remote.test/users/deep-replies'
        const rootStatusId = `${actorId}/statuses/deep-0`
        const overLimitStatusId = `${actorId}/statuses/deep-100`
        const queries: { bindings: unknown[]; sql: string }[] = []
        const handleQuery = ({
          bindings,
          sql
        }: {
          bindings?: unknown[]
          sql: string
        }) => {
          queries.push({ bindings: bindings ?? [], sql: sql.toLowerCase() })
        }

        try {
          await sqlDatabase.migrate()
          await sqlDatabase.createActor({
            actorId,
            username: 'deep-replies',
            domain: 'remote.test',
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            publicKey: 'public-key',
            createdAt: Date.now()
          })

          for (let index = 0; index < 102; index += 1) {
            const id = `${actorId}/statuses/deep-${index}`
            const reply =
              index === 0 ? '' : `${actorId}/statuses/deep-${index - 1}`
            await knexDatabase('statuses').insert({
              id,
              url: id,
              urlHash: getHashFromString(id),
              actorId,
              type: StatusType.enum.Note,
              content: JSON.stringify({
                id,
                url: id,
                text: `Deep reply ${index}`,
                summary: ''
              }),
              reply,
              replyHash: reply ? getHashFromString(reply) : null,
              originalStatusId: null,
              createdAt: new Date(index),
              updatedAt: new Date(index)
            })
          }

          knexDatabase.on('query', handleQuery)
          await expect(
            sqlDatabase.deleteStatus({ statusId: rootStatusId })
          ).rejects.toThrow(
            `Status reply deletion depth limit exceeded for status ${rootStatusId}`
          )
          knexDatabase.off('query', handleQuery)

          expect(
            queries.some(
              ({ bindings, sql }) =>
                sql.includes('from `statuses`') &&
                bindings.includes(overLimitStatusId)
            )
          ).toBe(false)
          await expect(
            knexDatabase('statuses').where('id', rootStatusId).first('id')
          ).resolves.toEqual({ id: rootStatusId })
        } finally {
          knexDatabase.off('query', handleQuery)
          await knexDatabase.destroy()
        }
      })

      it('deletes reply trees with bounded bulk cleanup queries', async () => {
        const knexDatabase = knex({
          client: 'better-sqlite3',
          useNullAsDefault: true,
          connection: {
            filename: ':memory:'
          }
        })
        const sqlDatabase = getSQLDatabase(knexDatabase)
        const actorId = 'https://remote.test/users/bulk-delete'
        const parentStatusId = `${actorId}/statuses/bulk-parent`
        const firstReplyStatusId = `${actorId}/statuses/bulk-reply-1`
        const secondReplyStatusId = `${actorId}/statuses/bulk-reply-2`
        const queries: { bindings: unknown[]; sql: string }[] = []
        const handleQuery = ({
          bindings,
          sql
        }: {
          bindings?: unknown[]
          sql: string
        }) => {
          queries.push({ bindings: bindings ?? [], sql: sql.toLowerCase() })
        }

        try {
          await sqlDatabase.migrate()
          await sqlDatabase.createActor({
            actorId,
            username: 'bulk-delete',
            domain: 'remote.test',
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            publicKey: 'public-key',
            createdAt: Date.now()
          })
          await sqlDatabase.createNote({
            id: parentStatusId,
            url: parentStatusId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Bulk parent #bulkdelete'
          })
          await sqlDatabase.createTag({
            statusId: parentStatusId,
            type: 'hashtag',
            name: '#BulkDelete',
            value: 'https://remote.test/tags/bulkdelete'
          })
          await sqlDatabase.createNote({
            id: firstReplyStatusId,
            url: firstReplyStatusId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Bulk reply 1',
            reply: parentStatusId
          })
          await sqlDatabase.createNote({
            id: secondReplyStatusId,
            url: secondReplyStatusId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Bulk reply 2',
            reply: parentStatusId
          })

          knexDatabase.on('query', handleQuery)
          await sqlDatabase.deleteStatus({ statusId: parentStatusId })
          knexDatabase.off('query', handleQuery)

          expect(
            queries.some(
              ({ sql }) =>
                sql.includes('from `statuses`') && sql.includes('`id` in')
            )
          ).toBe(true)
          expect(
            queries.some(
              ({ sql }) =>
                sql.includes('from `tags`') && sql.includes('`statusid` in')
            )
          ).toBe(true)
          expect(
            queries.some(
              ({ sql }) =>
                sql.startsWith('delete') &&
                sql.includes('`recipients`') &&
                sql.includes('`statusid` in')
            )
          ).toBe(true)
          const searchDocumentDeletes = queries.filter(
            ({ bindings, sql }) =>
              sql.startsWith('delete') &&
              sql.includes('`search_documents`') &&
              bindings.includes('status')
          )
          expect(searchDocumentDeletes).toHaveLength(1)
          expect(searchDocumentDeletes[0].sql).toContain('`entityid` in')
        } finally {
          knexDatabase.off('query', handleQuery)
          await knexDatabase.destroy()
        }
      })

      it('reserves actor filter bindings for owned status delete batches', async () => {
        const knexDatabase = knex({
          client: 'better-sqlite3',
          useNullAsDefault: true,
          connection: {
            filename: ':memory:'
          }
        })
        const sqlDatabase = getSQLDatabase(knexDatabase)
        const actorId = 'https://remote.test/users/owned-batch-delete'
        const rootStatusId = `${actorId}/statuses/root`
        const replyCount = SQLITE_MAX_BINDINGS
        const queries: { bindings: unknown[]; sql: string }[] = []
        const handleQuery = ({
          bindings,
          sql
        }: {
          bindings?: unknown[]
          sql: string
        }) => {
          queries.push({ bindings: bindings ?? [], sql: sql.toLowerCase() })
        }

        try {
          await sqlDatabase.migrate()
          await sqlDatabase.createActor({
            actorId,
            username: 'owned-batch-delete',
            domain: 'remote.test',
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            publicKey: 'public-key',
            createdAt: Date.now()
          })

          const statusRows = [
            {
              id: rootStatusId,
              url: rootStatusId,
              urlHash: getHashFromString(rootStatusId),
              actorId,
              type: StatusType.enum.Note,
              content: JSON.stringify({
                url: rootStatusId,
                text: 'Owned delete root',
                summary: ''
              }),
              reply: '',
              replyHash: null,
              originalStatusId: null,
              createdAt: new Date(0),
              updatedAt: new Date(0)
            },
            ...Array.from({ length: replyCount }, (_, index) => {
              const id = `${actorId}/statuses/reply-${index}`
              return {
                id,
                url: id,
                urlHash: getHashFromString(id),
                actorId,
                type: StatusType.enum.Note,
                content: JSON.stringify({
                  url: id,
                  text: `Owned delete reply ${index}`,
                  summary: ''
                }),
                reply: rootStatusId,
                replyHash: getHashFromString(rootStatusId),
                originalStatusId: null,
                createdAt: new Date(index + 1),
                updatedAt: new Date(index + 1)
              }
            })
          ]
          await knexDatabase.batchInsert('statuses', statusRows, 80)

          knexDatabase.on('query', handleQuery)
          await sqlDatabase.deleteStatus({ statusId: rootStatusId, actorId })
          knexDatabase.off('query', handleQuery)

          const statusDeleteBindingCounts = queries
            .filter(
              ({ sql }) =>
                sql.startsWith('delete') &&
                sql.includes('`statuses`') &&
                sql.includes('`id` in') &&
                sql.includes('`actorid` in')
            )
            .map(({ bindings }) => bindings.length)

          expect(statusDeleteBindingCounts.length).toBeGreaterThan(1)
          expect(Math.max(...statusDeleteBindingCounts)).toBeLessThanOrEqual(
            SQLITE_MAX_BINDINGS
          )
        } finally {
          knexDatabase.off('query', handleQuery)
          await knexDatabase.destroy()
        }
      })

      it('deletes status history and poll votes with status-scoped cleanup', async () => {
        const knexDatabase = knex({
          client: 'better-sqlite3',
          useNullAsDefault: true,
          connection: {
            filename: ':memory:'
          }
        })
        const sqlDatabase = getSQLDatabase(knexDatabase)
        const actorId = 'https://remote.test/users/delete-owned-status-data'
        const voterId = 'https://remote.test/users/delete-owned-status-voter'
        const noteId = `${actorId}/statuses/history-cleanup`
        const pollId = `${actorId}/statuses/poll-cleanup`
        const queries: string[] = []
        const handleQuery = ({ sql }: { sql: string }) => {
          queries.push(sql.toLowerCase())
        }
        const countRows = async (tableName: string, statusId: string) => {
          const row = await knexDatabase(tableName)
            .where({ statusId })
            .count<{ count: number | string }>('* as count')
            .first()
          return Number(row?.count ?? 0)
        }

        try {
          await sqlDatabase.migrate()
          await sqlDatabase.createActor({
            actorId,
            username: 'delete-owned-status-data',
            domain: 'remote.test',
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            publicKey: 'public-key',
            createdAt: Date.now()
          })
          await sqlDatabase.createActor({
            actorId: voterId,
            username: 'delete-owned-status-voter',
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

          await expect(countRows('status_history', noteId)).resolves.toBe(1)
          await expect(countRows('poll_answers', pollId)).resolves.toBe(1)
          await expect(countRows('poll_voters', pollId)).resolves.toBe(1)

          knexDatabase.on('query', handleQuery)
          await sqlDatabase.deleteStatus({ statusId: noteId, actorId })
          await sqlDatabase.deleteStatus({ statusId: pollId, actorId })
          knexDatabase.off('query', handleQuery)

          await expect(countRows('status_history', noteId)).resolves.toBe(0)
          await expect(countRows('poll_answers', pollId)).resolves.toBe(0)
          await expect(countRows('poll_voters', pollId)).resolves.toBe(0)
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
        } finally {
          knexDatabase.off('query', handleQuery)
          await knexDatabase.destroy()
        }
      })

      it('deletes auxiliary status references with bounded cleanup', async () => {
        const knexDatabase = knex({
          client: 'better-sqlite3',
          useNullAsDefault: true,
          connection: {
            filename: ':memory:'
          }
        })
        const sqlDatabase = getSQLDatabase(knexDatabase)
        const actorId = 'https://remote.test/users/delete-aux-status-data'
        const statusId = `${actorId}/statuses/aux-cleanup`
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

        try {
          await sqlDatabase.migrate()
          await sqlDatabase.createActor({
            actorId,
            username: 'delete-aux-status-data',
            domain: 'remote.test',
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            publicKey: 'public-key',
            createdAt: Date.now()
          })
          await sqlDatabase.createNote({
            id: statusId,
            url: statusId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Auxiliary cleanup note'
          })
          await knexDatabase('notifications').insert({
            id: 'aux-status-notification',
            actorId,
            type: 'mention',
            sourceActorId: actorId,
            statusId,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          await knexDatabase('direct_conversation_statuses').insert({
            conversationId: 'aux-status-conversation',
            statusId,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          await knexDatabase('fitness_files').insert({
            id: 'aux-status-fitness-file',
            actorId,
            statusId,
            path: '/tmp/aux-status.fit',
            fileName: 'aux-status.fit',
            fileType: 'fit',
            mimeType: 'application/octet-stream',
            bytes: 100,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          await knexDatabase('counters').insert(
            [
              CounterKey.totalLike(statusId),
              CounterKey.totalReblog(statusId),
              CounterKey.totalReply(statusId)
            ].map((id) => ({
              id,
              value: 1,
              createdAt: currentTime,
              updatedAt: currentTime
            }))
          )

          await expect(countRows('notifications', statusId)).resolves.toBe(1)
          await expect(
            countRows('direct_conversation_statuses', statusId)
          ).resolves.toBe(1)
          await expect(countRows('fitness_files', statusId)).resolves.toBe(1)

          knexDatabase.on('query', handleQuery)
          await sqlDatabase.deleteStatus({ statusId, actorId })
          knexDatabase.off('query', handleQuery)

          await expect(countRows('notifications', statusId)).resolves.toBe(0)
          await expect(
            countRows('direct_conversation_statuses', statusId)
          ).resolves.toBe(0)
          await expect(countRows('fitness_files', statusId)).resolves.toBe(0)
          await expect(
            knexDatabase('fitness_files')
              .where({ id: 'aux-status-fitness-file' })
              .first('statusId')
          ).resolves.toEqual({ statusId: null })
          await expect(
            knexDatabase('counters')
              .whereIn('id', [
                CounterKey.totalLike(statusId),
                CounterKey.totalReblog(statusId),
                CounterKey.totalReply(statusId)
              ])
              .count<{ count: number | string }>('* as count')
              .first()
              .then((row) => Number(row?.count ?? 0))
          ).resolves.toBe(0)

          const hasDirectStatusIdDelete = (tableName: string) =>
            queries.some(
              (sql) =>
                sql.startsWith('delete') &&
                sql.includes(`\`${tableName}\``) &&
                sql.includes('`statusid` in')
            )
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
        } finally {
          knexDatabase.off('query', handleQuery)
          await knexDatabase.destroy()
        }
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

      it('includes compact public posts in results and total', async () => {
        const compactTag = `compact_pagetag_${Date.now()}`
        const compactId = `${primaryActorId}/statuses/page-hashtag-${compactTag}`
        await database.createNote({
          id: compactId,
          url: compactId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC_COMPACT],
          cc: [],
          text: `Compact public post #${compactTag}`
        })
        await database.createTag({
          statusId: compactId,
          name: `#${compactTag}`,
          value: `https://${actors.primary.domain}/tags/${compactTag}`,
          type: 'hashtag'
        })

        const { statuses, total } = await database.getHashtagStatusesPage({
          hashtag: compactTag,
          limit: 10,
          offset: 0
        })
        expect(total).toBe(1)
        expect(statuses.map((status) => status.id)).toContain(compactId)
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
