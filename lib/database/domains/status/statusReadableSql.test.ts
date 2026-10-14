import {
  primaryActorId,
  replyAuthorId
} from '@/lib/database/domains/status/statusTestHelpers'
import { potentiallyReadableStatus } from '@/lib/database/kysely/visibility/potentiallyReadable'
import {
  publiclyReadableStatus,
  publiclyReadableStatusIds
} from '@/lib/database/kysely/visibility/publiclyReadable'
import { createCompileOnlyDb } from '@/lib/database/testing/compileOnlyDb'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { seedDatabase } from '@/lib/stub/database'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

describe('StatusDatabase readable status SQL', () => {
  describe('public readable status SQL', () => {
    it('stores reply hashes for created replies', async () => {
      const testDb = createTestDatabase({ backend: 'sqlite' })
      const { db, database: sqlDatabase } = testDb

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
          db
            .selectFrom('statuses')
            .select(['id', 'replyHash'])
            .where('id', 'in', [noteId, pollId])
            .orderBy('id', 'asc')
            .execute()
        ).resolves.toEqual([
          { id: noteId, replyHash: getHashFromString(reply) },
          { id: pollId, replyHash: getHashFromString(reply) }
        ])
      } finally {
        await testDb.destroy()
      }
    })

    it('uses reply hashes for recipientless parent URL visibility lookups', async () => {
      const testDb = createTestDatabase({ backend: 'sqlite' })
      const { db, database: sqlDatabase } = testDb

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
        await db
          .updateTable('statuses')
          .set({ replyHash: null })
          .where('id', '=', replyStatusId)
          .execute()

        const results = await sqlDatabase.getStatusesByIds({
          statusIds: [replyStatusId],
          visibleToActorId: visibleActorId
        })

        expect(results).toEqual([])
      } finally {
        await testDb.destroy()
      }
    })

    it('includes publicly readable legacy Announces that only store the target in content', async () => {
      // getRebloggedBy runs on Kysely; this one reaches PostgreSQL too.
      const testDb = createTestDatabase()
      const { database: sqlDatabase, db, prepare } = testDb

      try {
        await prepare()
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
        await db
          .insertInto('statuses')
          .values({
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
          .execute()
        await db
          .insertInto('recipients')
          .values({
            id: crypto.randomUUID(),
            statusId: legacyAnnounceId,
            actorId: ACTIVITY_STREAM_PUBLIC,
            type: 'to',
            createdAt,
            updatedAt: createdAt
          })
          .execute()

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
        await testDb.destroy()
      }
    })

    it('resolves a boost through originalStatusId when content disagrees', async () => {
      // The `20260517000000_add_status_original_status_id` migration
      // backfilled `originalStatusId` by JSON-parsing `content` and writing out
      // the `.url` or `.id` it found, leaving `content` holding the raw body.
      // Migrated rows therefore carry two different non-null strings and only
      // `originalStatusId` names the boosted status — which is why the pointer
      // is `COALESCE("originalStatusId", content)` and not the other way round.
      // `createAnnounce` always writes the two identically, so only a
      // hand-written row can tell the two orders apart.
      const testDb = createTestDatabase({ backend: 'sqlite' })
      const { db, database: sqlDatabase } = testDb

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
          await db
            .insertInto('statuses')
            .values({
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
            .execute()
          await db
            .insertInto('recipients')
            .values({
              id: crypto.randomUUID(),
              statusId: id,
              actorId: ACTIVITY_STREAM_PUBLIC,
              type: 'to',
              createdAt,
              updatedAt: createdAt
            })
            .execute()
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
        await testDb.destroy()
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
      // `publiclyReadableStatus`. `createAnnounce` always writes
      // `reply: ''`, so no number anyone can observe moves if that filter
      // goes — only a hand-written row pins the invariant.
      const testDb = createTestDatabase({ backend: 'sqlite' })
      const { db, database: sqlDatabase } = testDb

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
        await db
          .insertInto('statuses')
          .values({
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
          .execute()
        await db
          .insertInto('recipients')
          .values({
            id: crypto.randomUUID(),
            statusId: boostedReplyId,
            actorId: ACTIVITY_STREAM_PUBLIC,
            type: 'to',
            createdAt,
            updatedAt: createdAt
          })
          .execute()

        await expect(
          sqlDatabase.getStatusRepliesCount({
            statusId: parentId,
            publicOnly: true
          })
        ).resolves.toBe(1)
      } finally {
        await testDb.destroy()
      }
    })
  })

  describe('publiclyReadableStatus SQL', () => {
    // Compiles only: neither instance connects.
    const compile = (client: 'pg' | 'better-sqlite3') => {
      const db = createCompileOnlyDb(client === 'pg' ? 'pg' : 'sqlite')
      return db
        .selectFrom('statuses')
        .select('statuses.id')
        .where((eb) => publiclyReadableStatus(db, eb))
        .compile()
    }

    it.each([['pg' as const], ['better-sqlite3' as const]])(
      'inlines the Announce literal into the %s chain pointer',
      (client) => {
        // Inlined, so nothing bound sits inside the CASE: a bound value there
        // could swap places with another binding of the recursive term.
        const { sql, parameters } = compile(client)

        expect(sql).toContain(`= 'Announce' then coalesce(`)
        expect(sql.match(/then coalesce\(/g)).toHaveLength(3)
        // The three bound Announce values are the hop test, the chain's end
        // test and the outer row's own type test.
        expect(
          parameters.filter((value) => value === StatusType.enum.Announce)
        ).toHaveLength(3)
      }
    )

    it.each([['pg' as const], ['better-sqlite3' as const]])(
      'correlates the %s chain seed to the outer row through one pointer equality',
      (client) => {
        const { sql } = compile(client)
        const unquoted = sql.replace(/"/g, '')

        expect(unquoted.toLowerCase()).toContain(
          'with recursive announce_chain(id, type, originalpointer)'
        )
        expect(unquoted).toContain(
          "chain_seed.id = case when statuses.type = 'Announce' then " +
            'coalesce(statuses.originalStatusId, statuses.content) end'
        )
        expect(unquoted).toContain(
          'inner join announce_chain as chain_previous on chain_previous.originalPointer = chain_next.id'
        )
        // UNION, not UNION ALL, is what ends a boost cycle.
        expect(unquoted).toContain(' union ')
        expect(unquoted).not.toContain('union all')
        expect(unquoted).not.toContain('originalStatusId is null and')
      }
    )
  })

  describe('publiclyReadableStatusIds (the set form) SQL', () => {
    const targetActorId = 'https://llun.test/users/set-twin'

    // Compiles only: neither instance connects.
    const compile = (client: 'pg' | 'better-sqlite3') => {
      const db = createCompileOnlyDb(client === 'pg' ? 'pg' : 'sqlite')
      return publiclyReadableStatusIds(
        db,
        db
          .selectFrom('statuses')
          .select('statuses.id')
          .where('statuses.actorId', '=', targetActorId)
      ).compile()
    }

    it.each([['pg' as const], ['better-sqlite3' as const]])(
      'inlines the Announce literal into the %s chain pointer',
      (client) => {
        const { sql, parameters } = compile(client)

        expect(sql).toContain(`= 'Announce' then coalesce(`)
        expect(sql.match(/then coalesce\(/g)).toHaveLength(2)
        // The two bound Announce values are the hop test and the chain's end
        // test; the caller's target-set value is bound once, where the target
        // set reads it.
        expect(
          parameters.filter((value) => value === StatusType.enum.Announce)
        ).toHaveLength(2)
        expect(
          parameters.filter((value) => value === targetActorId)
        ).toHaveLength(1)
        expect(sql).not.toContain(`'${targetActorId}'`)
      }
    )

    it.each([['pg' as const], ['better-sqlite3' as const]])(
      'seeds the %s recursion with the target set and follows one pointer equality',
      (client) => {
        const { sql } = compile(client)
        const unquoted = sql.replace(/"/g, '')

        expect(unquoted).toContain(
          'with recursive publicly_readable_statuses(targetId, id, type, originalPointer)'
        )
        expect(unquoted).toContain(
          'from (select statuses.id from statuses where statuses.actorId = '
        )
        // The caller's target set seeds the recursion: it is read in the
        // first term, before the union that follows the chain.
        expect(unquoted.indexOf('statuses.actorId')).toBeLessThan(
          unquoted.indexOf(' union ')
        )
        expect(unquoted).toContain(
          'inner join statuses as target_statuses on target_statuses.id = target_status_ids.id'
        )
        expect(unquoted).toContain(
          'inner join publicly_readable_statuses as readable_statuses on readable_statuses.originalPointer = original_statuses.id'
        )
        // Each row carries the target it started from; that is the answer.
        expect(unquoted).toContain(
          'select publicly_readable_statuses.targetId as id from publicly_readable_statuses'
        )
        // UNION, not UNION ALL, is what ends a boost cycle.
        expect(unquoted).toContain(' union ')
        expect(unquoted).not.toContain('union all')
        expect(unquoted).not.toContain('originalStatusId is null and')
      }
    )
  })

  describe('potentially readable status SQL', () => {
    it('quotes camelCase identifiers in PostgreSQL follower audience checks', async () => {
      // Compiles only: the instance never connects. getStatusesByIds and the
      // feeds filter through this predicate.
      const db = createCompileOnlyDb('pg')
      const { sql } = db
        .selectFrom('statuses')
        .selectAll()
        .where('id', 'in', [`${primaryActorId}/statuses/postgres-readable`])
        .where((eb) => potentiallyReadableStatus(db, eb, replyAuthorId))
        .compile()

      expect(sql).toContain(
        '"followers_recipients"."statusId" = "statuses"."id"'
      )
      expect(sql).toContain('"follows"."targetActorId" = "statuses"."actorId"')
      expect(sql).toContain(
        '"followers_recipients"."actorId" = "statuses"."actorId" || \'/followers\''
      )
      expect(sql).toContain(
        '"followers_recipients"."actorId" = "status_actors"."settings"::jsonb ->> \'followersUrl\''
      )
    })
  })
})
