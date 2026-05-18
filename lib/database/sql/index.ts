import { Knex } from 'knex'

import { AccountSQLDatabaseMixin } from '@/lib/database/sql/account'
import { ActorSQLDatabaseMixin } from '@/lib/database/sql/actor'
import { AdminSQLDatabaseMixin } from '@/lib/database/sql/admin'
import { BlockSQLDatabaseMixin } from '@/lib/database/sql/block'
import { BookmarkSQLDatabaseMixin } from '@/lib/database/sql/bookmark'
import { DirectConversationSQLDatabaseMixin } from '@/lib/database/sql/conversation'
import { FitnessFileSQLDatabaseMixin } from '@/lib/database/sql/fitnessFile'
import { FitnessRouteHeatmapSQLDatabaseMixin } from '@/lib/database/sql/fitnessRouteHeatmap'
import { FitnessSettingsSQLDatabaseMixin } from '@/lib/database/sql/fitnessSettings'
import { FollowerSQLDatabaseMixin } from '@/lib/database/sql/follow'
import { LikeSQLDatabaseMixin } from '@/lib/database/sql/like'
import { MediaSQLDatabaseMixin } from '@/lib/database/sql/media'
import { NotificationSQLDatabaseMixin } from '@/lib/database/sql/notification'
import { OAuthSQLDatabaseMixin } from '@/lib/database/sql/oauth'
import { PushSubscriptionSQLDatabaseMixin } from '@/lib/database/sql/pushSubscription'
import {
  SearchSQLDatabaseMixin,
  getSearchDocumentId
} from '@/lib/database/sql/search'
import { StatusSQLDatabaseMixin } from '@/lib/database/sql/status'
import { StravaArchiveImportSQLDatabaseMixin } from '@/lib/database/sql/stravaArchiveImport'
import { TimelineSQLDatabaseMixin } from '@/lib/database/sql/timeline'
import { Database } from '@/lib/database/types'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'

const MAX_STATUS_DELETE_BFS_DEPTH = 1000

export const getSQLDatabase = (database: Knex): Database => {
  const accountDatabase = AccountSQLDatabaseMixin(database)
  const actorDatabase = ActorSQLDatabaseMixin(database)
  const adminDatabase = AdminSQLDatabaseMixin(database)
  const fitnessFileDatabase = FitnessFileSQLDatabaseMixin(database)
  const fitnessRouteHeatmapDatabase =
    FitnessRouteHeatmapSQLDatabaseMixin(database)
  const fitnessSettingsDatabase = FitnessSettingsSQLDatabaseMixin(database)
  const bookmarkDatabase = BookmarkSQLDatabaseMixin(database)
  const blockDatabase = BlockSQLDatabaseMixin(database)
  const followerDatabase = FollowerSQLDatabaseMixin(database, actorDatabase)
  const likeDatabase = LikeSQLDatabaseMixin(database)
  const mediaDatabase = MediaSQLDatabaseMixin(database)
  const notificationDatabase = NotificationSQLDatabaseMixin(database)
  const pushSubscriptionDatabase = PushSubscriptionSQLDatabaseMixin(database)
  const oauthDatabase = OAuthSQLDatabaseMixin(database)
  const stravaArchiveImportDatabase =
    StravaArchiveImportSQLDatabaseMixin(database)
  const statusDatabase = StatusSQLDatabaseMixin(
    database,
    actorDatabase,
    likeDatabase,
    bookmarkDatabase,
    mediaDatabase
  )
  const directConversationDatabase = DirectConversationSQLDatabaseMixin(
    database,
    statusDatabase
  )
  const timelineDatabase = TimelineSQLDatabaseMixin(database, statusDatabase)
  const searchDatabase = SearchSQLDatabaseMixin(
    database,
    actorDatabase,
    statusDatabase
  )
  const reindexHashtagsForStatus = async (statusId: string) => {
    const tags = await statusDatabase.getTags({ statusId })
    await Promise.all(
      tags
        .filter((tag) => tag.type === 'hashtag')
        .map((tag) =>
          searchDatabase.upsertHashtagSearchDocument({
            name: tag.name,
            url: tag.value
          })
        )
    )
  }
  type SearchDocumentReference = {
    entityType: 'account' | 'status' | 'hashtag'
    entityId: string
  }

  const getHashtagNamesForActorStatuses = async (
    actorId: string,
    query: Knex | Knex.Transaction = database
  ) => {
    const tags = await query('tags')
      .innerJoin('statuses', 'tags.statusId', 'statuses.id')
      .where('statuses.actorId', actorId)
      .where('tags.type', 'hashtag')
      .select<
        { name: string; nameNormalized: string | null }[]
      >('tags.name', 'tags.nameNormalized')
    return [
      ...new Set(tags.map((tag) => tag.nameNormalized ?? tag.name))
    ].filter(Boolean)
  }
  const getStatusIdsForDeleteWithBfs = async (
    statusId: string,
    query: Knex | Knex.Transaction = database
  ) => {
    const statusIds = [statusId]
    const seen = new Set(statusIds)
    let pendingParentIds = [statusId]
    let depth = 0

    while (pendingParentIds.length > 0) {
      if (depth >= MAX_STATUS_DELETE_BFS_DEPTH) {
        logger.warn({
          message: 'Status delete reply traversal exceeded maximum depth',
          statusId,
          maxDepth: MAX_STATUS_DELETE_BFS_DEPTH,
          collectedStatusCount: statusIds.length,
          pendingParentCount: pendingParentIds.length
        })
        throw new Error('Status reply tree exceeds maximum delete depth')
      }

      const replies = await query('statuses')
        .whereIn('reply', pendingParentIds)
        .select<{ id: string }[]>('id')
      pendingParentIds = replies
        .map((reply) => reply.id)
        .filter((id) => !seen.has(id))

      for (const id of pendingParentIds) {
        seen.add(id)
        statusIds.push(id)
      }
      depth += 1
    }

    return statusIds
  }
  const getStatusIdsForDelete = async (
    statusId: string,
    query: Knex | Knex.Transaction = database
  ) => {
    const clientName = String(database.client.config.client)
    if (clientName.includes('mysql')) {
      return getStatusIdsForDeleteWithBfs(statusId, query)
    }

    const rows = await query
      .withRecursive('reply_tree', ['id'], (cte) => {
        cte
          .select('id')
          .from('statuses')
          .where('id', statusId)
          .union((qb) => {
            qb.select('statuses.id')
              .from('statuses')
              .innerJoin('reply_tree', 'statuses.reply', 'reply_tree.id')
          })
      })
      .select<{ id: string }[]>('id')
      .from('reply_tree')

    return rows.map((row) => row.id)
  }
  const getHashtagTagsForStatuses = async (
    statusIds: string[],
    query: Knex | Knex.Transaction = database
  ) => {
    if (statusIds.length === 0) return []

    const tags = await query('tags')
      .whereIn('statusId', statusIds)
      .where('type', 'hashtag')
      .select<
        { name: string; nameNormalized: string | null; value: string }[]
      >('name', 'nameNormalized', 'value')
    return Array.from(
      tags
        .reduce((tagByName, tag) => {
          tagByName.set(tag.nameNormalized ?? tag.name, tag)
          return tagByName
        }, new Map<string, (typeof tags)[number]>())
        .values()
    )
  }
  const deleteStatusSearchDocumentsInTransaction = async (
    trx: Knex.Transaction,
    statusIds: string[]
  ) => {
    if (statusIds.length === 0) return

    const documentIds = statusIds.map((statusId) =>
      getSearchDocumentId('status', statusId)
    )
    // Keep child deletes explicit for SQLite connections without PRAGMA foreign_keys.
    await trx('search_terms').whereIn('documentId', documentIds).delete()
    await trx('search_documents').whereIn('id', documentIds).delete()
  }
  const getSearchDocumentsForActor = async (
    actorId: string,
    query: Knex | Knex.Transaction = database
  ): Promise<SearchDocumentReference[]> =>
    query('search_documents')
      .where('actorId', actorId)
      .select<SearchDocumentReference[]>('entityType', 'entityId')
  const deleteActorSearchDocumentsInTransaction = async (
    trx: Knex.Transaction,
    documents: SearchDocumentReference[]
  ) => {
    if (documents.length === 0) return

    const documentIds = documents.map((document) =>
      getSearchDocumentId(document.entityType, document.entityId)
    )
    // Keep child deletes explicit for SQLite connections without PRAGMA foreign_keys.
    await trx('search_terms').whereIn('documentId', documentIds).delete()
    await trx('search_documents').whereIn('id', documentIds).delete()
  }
  const syncDeletedSearchDocuments = async (
    documents: SearchDocumentReference[]
  ) => {
    await Promise.all(
      documents.map((document) =>
        searchDatabase.deleteSearchDocument({
          entityType: document.entityType,
          entityId: document.entityId,
          deleteSql: false
        })
      )
    )
  }
  const indexedAccountDatabase = {
    ...accountDatabase,
    async createAccount(
      ...args: Parameters<typeof accountDatabase.createAccount>
    ) {
      const accountId = await accountDatabase.createAccount(...args)
      const actors = await accountDatabase.getActorsForAccount({ accountId })
      await Promise.all(
        actors.map((actor) =>
          searchDatabase.upsertActorSearchDocument({ actorId: actor.id })
        )
      )
      return accountId
    },
    async createActorForAccount(
      ...args: Parameters<typeof accountDatabase.createActorForAccount>
    ) {
      const actorId = await accountDatabase.createActorForAccount(...args)
      await searchDatabase.upsertActorSearchDocument({ actorId })
      return actorId
    }
  }
  const indexedActorDatabase = {
    ...actorDatabase,
    async createActor(...args: Parameters<typeof actorDatabase.createActor>) {
      const actor = await actorDatabase.createActor(...args)
      if (actor) {
        await searchDatabase.upsertActorSearchDocument({ actorId: actor.id })
      }
      return actor
    },
    async createMastodonActor(
      ...args: Parameters<typeof actorDatabase.createMastodonActor>
    ) {
      const actor = await actorDatabase.createMastodonActor(...args)
      const [params] = args
      if (actor) {
        await searchDatabase.upsertActorSearchDocument({
          actorId: params.actorId
        })
      }
      return actor
    },
    async updateActor(...args: Parameters<typeof actorDatabase.updateActor>) {
      const actor = await actorDatabase.updateActor(...args)
      if (actor) {
        await searchDatabase.upsertActorSearchDocument({ actorId: actor.id })
      }
      return actor
    },
    async deleteActor(...args: Parameters<typeof actorDatabase.deleteActor>) {
      const [params] = args
      const { hashtagNames, documents } = await database.transaction(
        async (trx) => {
          const [hashtagNames, documents] = await Promise.all([
            getHashtagNamesForActorStatuses(params.actorId, trx),
            getSearchDocumentsForActor(params.actorId, trx)
          ])
          await actorDatabase.deleteActor({ ...params, trx })
          await deleteActorSearchDocumentsInTransaction(trx, documents)

          return { hashtagNames, documents }
        }
      )
      await syncDeletedSearchDocuments(documents)
      await Promise.all(
        hashtagNames.map((name) =>
          searchDatabase.upsertHashtagSearchDocument({ name })
        )
      )
    },
    async deleteActorData(
      ...args: Parameters<typeof actorDatabase.deleteActorData>
    ) {
      const [params] = args
      const { hashtagNames, documents } = await database.transaction(
        async (trx) => {
          const [hashtagNames, documents] = await Promise.all([
            getHashtagNamesForActorStatuses(params.actorId, trx),
            getSearchDocumentsForActor(params.actorId, trx)
          ])
          await actorDatabase.deleteActorData({ ...params, trx })
          await deleteActorSearchDocumentsInTransaction(trx, documents)

          return { hashtagNames, documents }
        }
      )
      await syncDeletedSearchDocuments(documents)
      await Promise.all(
        hashtagNames.map((name) =>
          searchDatabase.upsertHashtagSearchDocument({ name })
        )
      )
    }
  }
  const indexedStatusDatabase = {
    ...statusDatabase,
    async createNote(...args: Parameters<typeof statusDatabase.createNote>) {
      const status = await statusDatabase.createNote(...args)
      await searchDatabase.upsertStatusSearchDocument({ statusId: status.id })
      return status
    },
    async createPoll(...args: Parameters<typeof statusDatabase.createPoll>) {
      const status = await statusDatabase.createPoll(...args)
      await searchDatabase.upsertStatusSearchDocument({ statusId: status.id })
      return status
    },
    async updateNote(...args: Parameters<typeof statusDatabase.updateNote>) {
      const status = await statusDatabase.updateNote(...args)
      const [params] = args
      await searchDatabase.upsertStatusSearchDocument({
        statusId: params.statusId
      })
      await reindexHashtagsForStatus(params.statusId)
      return status
    },
    async updatePoll(...args: Parameters<typeof statusDatabase.updatePoll>) {
      const status = await statusDatabase.updatePoll(...args)
      const [params] = args
      await searchDatabase.upsertStatusSearchDocument({
        statusId: params.statusId
      })
      await reindexHashtagsForStatus(params.statusId)
      return status
    },
    async updateNoteVisibility(
      ...args: Parameters<typeof statusDatabase.updateNoteVisibility>
    ) {
      const status = await statusDatabase.updateNoteVisibility(...args)
      const [params] = args
      await searchDatabase.upsertStatusSearchDocument({
        statusId: params.statusId
      })
      await reindexHashtagsForStatus(params.statusId)
      return status
    },
    async createTag(...args: Parameters<typeof statusDatabase.createTag>) {
      const tag = await statusDatabase.createTag(...args)
      if (tag.type === 'hashtag') {
        await Promise.all([
          searchDatabase.upsertStatusSearchDocument({ statusId: tag.statusId }),
          searchDatabase.upsertHashtagSearchDocument({
            name: tag.name,
            url: tag.value
          })
        ])
      }
      return tag
    },
    async deleteStatus(
      ...args: Parameters<typeof statusDatabase.deleteStatus>
    ) {
      const [params] = args
      const { statusIds, tags } = await database.transaction(async (trx) => {
        const status = await trx('statuses')
          .where('id', params.statusId)
          .first<{ actorId: string }>('actorId')

        if (params.actorId && status) {
          const normalizedStoredActorId = normalizeActorId(status.actorId)
          const normalizedExpectedActorId = normalizeActorId(params.actorId)
          if (
            !normalizedStoredActorId ||
            !normalizedExpectedActorId ||
            normalizedStoredActorId !== normalizedExpectedActorId
          ) {
            return { statusIds: [], tags: [] }
          }
        }

        const statusIds = status
          ? await getStatusIdsForDelete(params.statusId, trx)
          : [params.statusId]
        const tags = await getHashtagTagsForStatuses(statusIds, trx)
        await statusDatabase.deleteStatus({
          ...params,
          trx
        } as Parameters<typeof statusDatabase.deleteStatus>[0] & {
          trx: Knex.Transaction
        })
        await deleteStatusSearchDocumentsInTransaction(trx, statusIds)

        return { statusIds, tags }
      })

      await syncDeletedSearchDocuments(
        statusIds.map((statusId) => ({
          entityType: 'status',
          entityId: statusId
        }))
      )
      await Promise.all(
        tags.map((tag) =>
          searchDatabase.upsertHashtagSearchDocument({
            name: tag.name,
            url: tag.value
          })
        )
      )
    }
  }

  return {
    async migrate() {
      await database.migrate.latest({ disableTransactions: true })
    },

    async destroy() {
      await database.destroy()
    },

    ...indexedAccountDatabase,
    ...indexedActorDatabase,
    ...adminDatabase,
    ...fitnessFileDatabase,
    ...fitnessRouteHeatmapDatabase,
    ...fitnessSettingsDatabase,
    ...bookmarkDatabase,
    ...blockDatabase,
    ...followerDatabase,
    ...likeDatabase,
    ...mediaDatabase,
    ...notificationDatabase,
    ...pushSubscriptionDatabase,
    ...oauthDatabase,
    ...stravaArchiveImportDatabase,
    ...indexedStatusDatabase,
    ...directConversationDatabase,
    ...searchDatabase,

    ...timelineDatabase
  }
}
