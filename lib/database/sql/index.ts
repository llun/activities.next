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
import { StatusType } from '@/lib/types/domain/status'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'

const MAX_STATUS_DELETE_REPLY_DEPTH = 256
const SQL_WHERE_IN_BATCH_SIZE = 500
const SEARCH_DOCUMENT_STATUS_TYPES: StatusType[] = [
  StatusType.enum.Note,
  StatusType.enum.Poll
]

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

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
    await searchDatabase.upsertHashtagSearchDocuments({
      names: tags.filter((tag) => tag.type === 'hashtag').map((tag) => tag.name)
    })
  }
  type SearchDocumentReference = {
    entityType: 'account' | 'status' | 'hashtag'
    entityId: string
  }
  type StatusDeleteReference = {
    id: string
    type: string
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
  const getStatusRowsForDelete = async (
    statusId: string,
    query: Knex | Knex.Transaction = database
  ) => {
    const rootStatus = await query('statuses')
      .where('id', statusId)
      .first<StatusDeleteReference>('id', 'type')
    if (!rootStatus) return []

    const statusRows = [rootStatus]
    const seen = new Set([statusId])
    let pendingParentIds = [statusId]
    let depth = 0

    while (pendingParentIds.length > 0) {
      const replyGroups = await Promise.all(
        chunkArray(pendingParentIds, SQL_WHERE_IN_BATCH_SIZE).map(
          (parentIdChunk) =>
            query('statuses')
              .whereIn('reply', parentIdChunk)
              .select<StatusDeleteReference[]>('id', 'type')
        )
      )
      const replies = replyGroups.flat()
      const nextRows = replies.filter((reply) => !seen.has(reply.id))
      if (nextRows.length === 0) break

      if (depth >= MAX_STATUS_DELETE_REPLY_DEPTH) {
        logger.warn({
          message:
            'Status delete reply traversal exceeded maximum depth; continuing with partial search index cleanup',
          statusId,
          maxDepth: MAX_STATUS_DELETE_REPLY_DEPTH,
          collectedStatusCount: statusRows.length,
          pendingParentCount: pendingParentIds.length,
          overflowChildCount: nextRows.length
        })
        break
      }

      for (const row of nextRows) {
        seen.add(row.id)
        statusRows.push(row)
      }
      pendingParentIds = nextRows.map((row) => row.id)
      depth += 1
    }

    return statusRows
  }
  const getSearchableStatusIds = (statusRows: StatusDeleteReference[]) =>
    statusRows
      .filter((status) =>
        SEARCH_DOCUMENT_STATUS_TYPES.includes(status.type as StatusType)
      )
      .map((status) => status.id)
  const getHashtagTagsForStatuses = async (
    statusIds: string[],
    query: Knex | Knex.Transaction = database
  ) => {
    if (statusIds.length === 0) return []

    const tagGroups = await Promise.all(
      chunkArray(statusIds, SQL_WHERE_IN_BATCH_SIZE).map((statusIdChunk) =>
        query('tags')
          .whereIn('statusId', statusIdChunk)
          .where('type', 'hashtag')
          .select<
            { name: string; nameNormalized: string | null; value: string }[]
          >('name', 'nameNormalized', 'value')
      )
    )
    const tags = tagGroups.flat()
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
    for (const documentIdChunk of chunkArray(
      documentIds,
      SQL_WHERE_IN_BATCH_SIZE
    )) {
      // Keep child deletes explicit for SQLite connections without PRAGMA foreign_keys.
      await trx('search_terms').whereIn('documentId', documentIdChunk).delete()
      await trx('search_documents').whereIn('id', documentIdChunk).delete()
    }
  }
  const getSearchDocumentsForActor = async (
    actorId: string,
    query: Knex | Knex.Transaction = database
  ): Promise<SearchDocumentReference[]> =>
    query('search_documents')
      .where('actorId', actorId)
      .select<SearchDocumentReference[]>('entityType', 'entityId')
  const getSearchableStatusIdsForActor = async (
    actorId: string,
    query: Knex | Knex.Transaction = database
  ) => {
    const statuses = await query('statuses')
      .where('actorId', actorId)
      .whereIn('type', SEARCH_DOCUMENT_STATUS_TYPES)
      .select<{ id: string }[]>('id')
    return statuses.map((status) => status.id)
  }
  const deleteActorSearchDocumentsInTransaction = async (
    trx: Knex.Transaction,
    documents: SearchDocumentReference[]
  ) => {
    if (documents.length === 0) return

    const documentIds = documents.map((document) =>
      getSearchDocumentId(document.entityType, document.entityId)
    )
    for (const documentIdChunk of chunkArray(
      documentIds,
      SQL_WHERE_IN_BATCH_SIZE
    )) {
      // Keep child deletes explicit for SQLite connections without PRAGMA foreign_keys.
      await trx('search_terms').whereIn('documentId', documentIdChunk).delete()
      await trx('search_documents').whereIn('id', documentIdChunk).delete()
    }
  }
  const syncDeletedSearchDocuments = async (
    documents: SearchDocumentReference[]
  ) => {
    await searchDatabase.deleteSearchDocuments({
      documents,
      deleteSql: false
    })
  }
  const reindexActorSearchDocuments = async (actorId: string) => {
    const [statusIds, hashtagNames] = await Promise.all([
      getSearchableStatusIdsForActor(actorId),
      getHashtagNamesForActorStatuses(actorId)
    ])

    await searchDatabase.upsertActorSearchDocument({ actorId })
    for (const statusIdChunk of chunkArray(
      statusIds,
      SQL_WHERE_IN_BATCH_SIZE
    )) {
      await Promise.all(
        statusIdChunk.map((statusId) =>
          searchDatabase.upsertStatusSearchDocument({ statusId })
        )
      )
    }
    await searchDatabase.upsertHashtagSearchDocuments({ names: hashtagNames })
  }
  const deindexActorSearchDocuments = async (
    actorId: string,
    updateActor: (trx: Knex.Transaction) => Promise<void>
  ) => {
    const { hashtagNames, documents } = await database.transaction(
      async (trx) => {
        const [hashtagNames, documents] = await Promise.all([
          getHashtagNamesForActorStatuses(actorId, trx),
          getSearchDocumentsForActor(actorId, trx)
        ])

        await updateActor(trx)
        await deleteActorSearchDocumentsInTransaction(trx, documents)

        return { hashtagNames, documents }
      }
    )

    await syncDeletedSearchDocuments(documents)
    await searchDatabase.upsertHashtagSearchDocuments({ names: hashtagNames })
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
    async scheduleActorDeletion(
      ...args: Parameters<typeof actorDatabase.scheduleActorDeletion>
    ) {
      const [params] = args
      await deindexActorSearchDocuments(params.actorId, (trx) =>
        actorDatabase.scheduleActorDeletion({ ...params, trx } as Parameters<
          typeof actorDatabase.scheduleActorDeletion
        >[0] & { trx: Knex.Transaction })
      )
    },
    async cancelActorDeletion(
      ...args: Parameters<typeof actorDatabase.cancelActorDeletion>
    ) {
      await actorDatabase.cancelActorDeletion(...args)
      const [params] = args
      await reindexActorSearchDocuments(params.actorId)
    },
    async startActorDeletion(
      ...args: Parameters<typeof actorDatabase.startActorDeletion>
    ) {
      const [params] = args
      await deindexActorSearchDocuments(params.actorId, (trx) =>
        actorDatabase.startActorDeletion({ ...params, trx } as Parameters<
          typeof actorDatabase.startActorDeletion
        >[0] & { trx: Knex.Transaction })
      )
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
      await searchDatabase.upsertHashtagSearchDocuments({ names: hashtagNames })
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
      await searchDatabase.upsertHashtagSearchDocuments({ names: hashtagNames })
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
            name: tag.name
          })
        ])
      }
      return tag
    },
    async deleteStatus(
      ...args: Parameters<typeof statusDatabase.deleteStatus>
    ) {
      const [params] = args
      const { searchableStatusIds, tags } = await database.transaction(
        async (trx) => {
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
              return { searchableStatusIds: [], tags: [] }
            }
          }

          const statusRows = status
            ? await getStatusRowsForDelete(params.statusId, trx)
            : []
          const statusIds = status
            ? statusRows.map((row) => row.id)
            : [params.statusId]
          const searchableStatusIds = status
            ? getSearchableStatusIds(statusRows)
            : [params.statusId]
          const tags = await getHashtagTagsForStatuses(statusIds, trx)
          await statusDatabase.deleteStatus({
            ...params,
            trx
          } as Parameters<typeof statusDatabase.deleteStatus>[0] & {
            trx: Knex.Transaction
          })
          await deleteStatusSearchDocumentsInTransaction(
            trx,
            searchableStatusIds
          )

          return { searchableStatusIds, tags }
        }
      )

      await syncDeletedSearchDocuments(
        searchableStatusIds.map((statusId) => ({
          entityType: 'status',
          entityId: statusId
        }))
      )
      await searchDatabase.upsertHashtagSearchDocuments({
        names: tags.map((tag) => tag.name)
      })
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
