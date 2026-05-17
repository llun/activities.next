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
import { SearchSQLDatabaseMixin } from '@/lib/database/sql/search'
import { StatusSQLDatabaseMixin } from '@/lib/database/sql/status'
import { StravaArchiveImportSQLDatabaseMixin } from '@/lib/database/sql/stravaArchiveImport'
import { TimelineSQLDatabaseMixin } from '@/lib/database/sql/timeline'
import { Database } from '@/lib/database/types'

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
  const getHashtagNamesForActorStatuses = async (actorId: string) => {
    const tags = await database('tags')
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
  const deleteSearchDocumentsForActor = async (actorId: string) => {
    const documents = await database('search_documents')
      .where('actorId', actorId)
      .select<{ id: string }[]>('id')
    if (documents.length === 0) return

    const documentIds = documents.map((document) => document.id)
    await database.transaction(async (trx) => {
      await trx('search_terms').whereIn('documentId', documentIds).delete()
      await trx('search_documents').whereIn('id', documentIds).delete()
    })
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
      await actorDatabase.deleteActor(...args)
      await deleteSearchDocumentsForActor(params.actorId)
    },
    async deleteActorData(
      ...args: Parameters<typeof actorDatabase.deleteActorData>
    ) {
      const [params] = args
      const hashtagNames = await getHashtagNamesForActorStatuses(params.actorId)
      await actorDatabase.deleteActorData(...args)
      await deleteSearchDocumentsForActor(params.actorId)
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
      const tags = await statusDatabase.getTags({ statusId: params.statusId })
      await statusDatabase.deleteStatus(...args)
      await searchDatabase.deleteSearchDocument({
        entityType: 'status',
        entityId: params.statusId
      })
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
