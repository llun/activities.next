import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import {
  primaryActorId,
  replyAuthorId
} from '@/lib/database/sql/statusTestHelpers'
import { seedDatabase } from '@/lib/stub/database'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { buildPubliclyReadableStatusIdsQuery } from './status'

describe('StatusDatabase readable status SQL', () => {
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

    it.each([['pg'], ['better-sqlite3']])(
      'inlines the Announce literal into the %s chain pointer',
      async (client) => {
        // knex emits a UNION'd CTE term's FROM bindings before its select-list
        // bindings, so a bound `?` in the chain-pointer CASE would swap with
        // the caller's target-set value: the CASE would compare the status type
        // against the target actor id and the target set would filter on
        // 'Announce'. Both queries still run, both return nothing useful.
        const targetActorId = 'https://llun.test/users/binding-order'
        const database = knex({ client, useNullAsDefault: true })
        const sql = buildPubliclyReadableStatusIdsQuery({
          database,
          targetStatusIds: database('statuses')
            .select('statuses.id')
            .where('statuses.actorId', targetActorId)
        }).toString()

        expect(sql).toContain("= 'Announce' then coalesce(")
        expect(sql).toContain(`= '${targetActorId}'`)
        expect(sql).not.toContain(`= '${targetActorId}' then coalesce(`)

        await database.destroy()
      }
    )

    it.each([['pg'], ['better-sqlite3']])(
      'follows the %s announce chain through one pointer equality',
      async (client) => {
        // The chain used to be joined with `originalStatusId = id OR
        // (originalStatusId IS NULL AND content = id)`, which costs a BitmapOr
        // of two primary-key probes per row and drags the wide `content` text
        // through the recursion's working table.
        const database = knex({ client, useNullAsDefault: true })
        const sql = buildPubliclyReadableStatusIdsQuery({
          database,
          targetStatusIds: database('statuses')
            .select('statuses.id')
            .where('statuses.actorId', 'https://llun.test/users/chain')
        })
          .toString()
          .replace(/[`"]/g, '')

        expect(sql).toContain(
          'on readable_statuses.originalPointer = original_statuses.id'
        )
        expect(sql).not.toContain('originalStatusId is null and')

        await database.destroy()
      }
    )

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

    it('resolves the MySQL announce chain through the same pointer expression', async () => {
      // MySQL has no CI coverage, so the only thing keeping this branch from
      // drifting away from the recursive one is that both build the chain
      // pointer from `announceOriginalPointer`.
      const mysqlDatabase = knex({ client: 'mysql2' })
      const sql = buildPubliclyReadableStatusIdsQuery({
        database: mysqlDatabase,
        targetStatusIds: createTargetStatusIds(mysqlDatabase)
      })
        .toString()
        .replace(/[`"]/g, '')

      expect(sql).toContain(
        "original_statuses.id = case when target_statuses.type = 'Announce' " +
          'then coalesce(target_statuses.originalStatusId, target_statuses.content) end'
      )
      expect(sql).not.toContain('originalStatusId is null and')

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
          reply: (parent as StatusNote).url
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

    it('resolves a boost through originalStatusId when content disagrees', async () => {
      // `20260517000000_add_status_original_status_id.js` backfills
      // `originalStatusId` by JSON-parsing `content` and writing out the `.url`
      // or `.id` it finds, leaving `content` holding the raw body. Migrated rows
      // therefore carry two different non-null strings and only
      // `originalStatusId` names the boosted status — which is why the pointer
      // is `COALESCE("originalStatusId", content)` and not the other way round.
      // `createAnnounce` always writes the two identically, so only a
      // hand-written row can tell the two orders apart.
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

        const publicTargetId = `${primaryActorId}/statuses/divergent-public`
        const privateTargetId = `${primaryActorId}/statuses/divergent-private`
        await sqlDatabase.createNote({
          id: publicTargetId,
          url: publicTargetId,
          actorId: primaryActorId,
          text: 'Public divergent target',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        await sqlDatabase.createNote({
          id: privateTargetId,
          url: privateTargetId,
          actorId: primaryActorId,
          text: 'Private divergent target',
          to: [`${primaryActorId}/followers`],
          cc: []
        })

        const insertPublicAnnounce = async ({
          id,
          originalStatusId,
          content
        }: {
          id: string
          originalStatusId: string
          content: string
        }) => {
          const createdAt = new Date('2024-05-01T00:00:00.000Z')
          await knexDatabase('statuses').insert({
            id,
            url: null,
            urlHash: null,
            actorId: replyAuthorId,
            type: StatusType.enum.Announce,
            reply: '',
            content,
            originalStatusId,
            createdAt,
            updatedAt: createdAt
          })
          await knexDatabase('recipients').insert({
            id: crypto.randomUUID(),
            statusId: id,
            actorId: ACTIVITY_STREAM_PUBLIC,
            type: 'to',
            createdAt,
            updatedAt: createdAt
          })
        }

        const before = await sqlDatabase.getActorStatusesCount({
          actorId: replyAuthorId,
          publicOnly: true
        })

        // originalStatusId names the private status, so this boost is not
        // publicly readable. Reading `content` first would resolve the public
        // one and count it.
        await insertPublicAnnounce({
          id: `${replyAuthorId}/statuses/divergent-hidden`,
          originalStatusId: privateTargetId,
          content: publicTargetId
        })
        await expect(
          sqlDatabase.getActorStatusesCount({
            actorId: replyAuthorId,
            publicOnly: true
          })
        ).resolves.toBe(before)

        // And the mirror: originalStatusId names the public status, so this one
        // counts even though `content` points somewhere unreadable.
        await insertPublicAnnounce({
          id: `${replyAuthorId}/statuses/divergent-visible`,
          originalStatusId: publicTargetId,
          content: privateTargetId
        })
        await expect(
          sqlDatabase.getActorStatusesCount({
            actorId: replyAuthorId,
            publicOnly: true
          })
        ).resolves.toBe(before + 1)
      } finally {
        await knexDatabase.destroy()
      }
    })

    it('keeps a boosted reply out of the public replies count', async () => {
      // `getStatusRepliesCount`'s `whereNot('type', Announce)` filters the
      // REPLY row, and is not redundant with the readability predicate: an
      // Announce whose boosted original is a public Note is publicly readable,
      // so only the outer filter keeps it out of a reply count. That held when
      // the filter was the readable-ids subquery (whose `type` was the resolved
      // original's, a different row again) and still holds now that
      // `getStatusRepliesCount` uses the correlated
      // `wherePubliclyReadableStatus`. `createAnnounce` always writes
      // `reply: ''`, so no number anyone can observe moves if that filter
      // goes — only a hand-written row pins the invariant.
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

        const parentId = `${primaryActorId}/statuses/boosted-reply-parent`
        await sqlDatabase.createNote({
          id: parentId,
          url: parentId,
          actorId: primaryActorId,
          text: 'Parent of a boosted reply',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        await sqlDatabase.createNote({
          id: `${replyAuthorId}/statuses/boosted-reply-child`,
          url: `${replyAuthorId}/statuses/boosted-reply-child`,
          actorId: replyAuthorId,
          text: 'A real reply',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          reply: parentId
        })

        // An Announce carrying the parent's id, but also pointing `reply` at
        // it. It resolves to a publicly readable Note, so the subquery returns
        // it; it is still a boost, not a reply.
        const boostedReplyId = `${replyAuthorId}/statuses/boosted-reply-announce`
        const createdAt = new Date('2024-06-01T00:00:00.000Z')
        await knexDatabase('statuses').insert({
          id: boostedReplyId,
          url: null,
          urlHash: null,
          actorId: replyAuthorId,
          type: StatusType.enum.Announce,
          reply: parentId,
          content: parentId,
          originalStatusId: parentId,
          createdAt,
          updatedAt: createdAt
        })
        await knexDatabase('recipients').insert({
          id: crypto.randomUUID(),
          statusId: boostedReplyId,
          actorId: ACTIVITY_STREAM_PUBLIC,
          type: 'to',
          createdAt,
          updatedAt: createdAt
        })

        await expect(
          sqlDatabase.getStatusRepliesCount({
            statusId: parentId,
            publicOnly: true
          })
        ).resolves.toBe(1)
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
      postgresDatabase.client.acquireConnection = vi.fn().mockResolvedValue({
        query: vi.fn((_queryConfig, callback) => {
          callback(null, { command: 'SELECT', rows: [] })
        })
      })
      postgresDatabase.client.releaseConnection = vi.fn()

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
})
