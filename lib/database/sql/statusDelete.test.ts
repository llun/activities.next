import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import {
  extraActorId,
  primaryActorId,
  statuses
} from '@/lib/database/sql/statusTestHelpers'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import { SQLITE_MAX_BINDINGS } from '@/lib/database/sql/utils/knex'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { StatusType } from '@/lib/types/domain/status'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

describe('StatusDatabase deletion', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database as Database)
    })

    describe('deleteStatus', () => {
      it('deletes a status', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const statusId = `${primaryActorId}/statuses/delete-status-${suffix}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Status to delete'
        })
        const beforeDeleteCount = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        await database.deleteStatus({
          statusId
        })
        const afterDeleteCount = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        expect(
          await database.getStatus({
            statusId
          })
        ).toBeNull()
        expect(afterDeleteCount).toBe(beforeDeleteCount - 1)
      })

      it('removes emoji reactions for a deleted status', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const statusId = `${primaryActorId}/statuses/delete-reactions-${suffix}`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Delete reactions status'
        })
        await database.createStatusReaction({
          statusId,
          actorId: primaryActorId,
          name: '\u{1F525}'
        })
        expect(
          await database.getStatusReactionRollups({ statusIds: [statusId] })
        ).toHaveLength(1)

        await database.deleteStatus({ statusId })

        expect(
          await database.getStatusReactionRollups({ statusIds: [statusId] })
        ).toEqual([])
      })

      it('removes the detected-language row for a deleted status', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const statusId = `${primaryActorId}/statuses/delete-detected-${suffix}`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Delete detected language status'
        })
        await database.setDetectedLanguage({ statusId, language: 'th' })
        expect(await database.getDetectedLanguage({ statusId })).toBe('th')

        await database.deleteStatus({ statusId })

        expect(await database.getDetectedLanguage({ statusId })).toBeNull()
      })

      it('deletes a status and attachments', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const statusId = `${primaryActorId}/statuses/delete-attachments-${suffix}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: primaryActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Status with attachments to delete'
        })
        await database.createAttachment({
          actorId: primaryActorId,
          statusId,
          mediaType: 'image/png',
          url: 'https://llun.test/images/test.png',
          width: 100,
          height: 100,
          name: 'test'
        })
        const beforeDeleteCount = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        await database.deleteStatus({
          statusId
        })
        const afterDeleteCount = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        expect(
          await database.getStatus({
            statusId
          })
        ).toBeNull()
        expect(
          await database.getAttachments({
            statusId
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

          type StatusBatchRow = {
            id: string
            url: string
            urlHash: string
            actorId: string
            type: StatusType
            content: string
            reply: string
            replyHash: string | null
            originalStatusId: string | null
            createdAt: Date
            updatedAt: Date
          }

          const statusRows: StatusBatchRow[] = [
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

      describe('deleting a status with auxiliary references', () => {
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

        beforeAll(async () => {
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
        })

        afterAll(async () => {
          knexDatabase.off('query', handleQuery)
          await knexDatabase.destroy()
        })

        it('removes notifications, direct-conversation rows, fitness links and counters', async () => {
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
        })

        it('uses bounded direct statusId deletes (query shape)', () => {
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
        })
      })
    })

    describe('instance activity local status buckets', () => {
      it('increments local status buckets only for statuses from local actors', async () => {
        const knexDatabase = knex({
          client: 'better-sqlite3',
          useNullAsDefault: true,
          connection: {
            filename: ':memory:'
          }
        })
        const sqlDatabase = getSQLDatabase(knexDatabase)

        const getCounterTotal = async (counterType: string) => {
          const row = await knexDatabase('counters')
            .where('id', 'like', `bucket:${counterType}:%`)
            .sum<{ total: number | string | null }>('value as total')
            .first()
          return Number(row?.total ?? 0)
        }

        try {
          await sqlDatabase.migrate()

          const suffix = crypto.randomUUID().slice(0, 8)
          const localUsername = `local-status-${suffix}`
          const localActorId = `https://${TEST_DOMAIN}/users/${localUsername}`
          const remoteActorId = `https://remote-${suffix}.test/users/alice`

          await sqlDatabase.createAccount({
            email: `${localUsername}@${TEST_DOMAIN}`,
            username: localUsername,
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: `private-${suffix}`,
            publicKey: `public-${suffix}`
          })
          await sqlDatabase.createActor({
            actorId: remoteActorId,
            username: `alice-${suffix}`,
            domain: `remote-${suffix}.test`,
            followersUrl: `${remoteActorId}/followers`,
            inboxUrl: `${remoteActorId}/inbox`,
            sharedInboxUrl: `https://remote-${suffix}.test/inbox`,
            publicKey: `remote-public-${suffix}`,
            createdAt: Date.now()
          })

          await sqlDatabase.createNote({
            id: `${localActorId}/statuses/local-bucket`,
            url: `${localActorId}/statuses/local-bucket`,
            actorId: localActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Local status'
          })
          await sqlDatabase.createNote({
            id: `${remoteActorId}/statuses/remote-bucket`,
            url: `${remoteActorId}/statuses/remote-bucket`,
            actorId: remoteActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Remote status'
          })

          expect(await getCounterTotal('statuses')).toBe(2)
          expect(await getCounterTotal('local-statuses')).toBe(1)
        } finally {
          await knexDatabase.destroy()
        }
      })
    })
  })
})
