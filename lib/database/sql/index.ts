import { Knex } from 'knex'

import { AccountSQLDatabaseMixin } from '@/lib/database/sql/account'
import { AccountNoteSQLDatabaseMixin } from '@/lib/database/sql/accountNote'
import { ActorSQLDatabaseMixin } from '@/lib/database/sql/actor'
import { AdminSQLDatabaseMixin } from '@/lib/database/sql/admin'
import { AnnouncementSQLDatabaseMixin } from '@/lib/database/sql/announcement'
import { BlockSQLDatabaseMixin } from '@/lib/database/sql/block'
import { BookmarkSQLDatabaseMixin } from '@/lib/database/sql/bookmark'
import { CollectionSQLDatabaseMixin } from '@/lib/database/sql/collection'
import { DirectConversationSQLDatabaseMixin } from '@/lib/database/sql/conversation'
import { CustomEmojiSQLDatabaseMixin } from '@/lib/database/sql/customEmoji'
import { EndorsementSQLDatabaseMixin } from '@/lib/database/sql/endorsement'
import { FeaturedTagSQLDatabaseMixin } from '@/lib/database/sql/featuredTag'
import { FilterSQLDatabaseMixin } from '@/lib/database/sql/filter'
import { FitnessFileSQLDatabaseMixin } from '@/lib/database/sql/fitnessFile'
import { FitnessRouteHeatmapSQLDatabaseMixin } from '@/lib/database/sql/fitnessRouteHeatmap'
import { FitnessSettingsSQLDatabaseMixin } from '@/lib/database/sql/fitnessSettings'
import { FollowerSQLDatabaseMixin } from '@/lib/database/sql/follow'
import { FollowedTagSQLDatabaseMixin } from '@/lib/database/sql/followedTag'
import { IdempotencySQLDatabaseMixin } from '@/lib/database/sql/idempotency'
import { ImportLockSQLDatabaseMixin } from '@/lib/database/sql/importLock'
import { InstanceActivitySQLDatabaseMixin } from '@/lib/database/sql/instanceActivity'
import { InstanceRuleSQLDatabaseMixin } from '@/lib/database/sql/instanceRule'
import { LikeSQLDatabaseMixin } from '@/lib/database/sql/like'
import { ListSQLDatabaseMixin } from '@/lib/database/sql/list'
import { MarkerSQLDatabaseMixin } from '@/lib/database/sql/marker'
import { MediaSQLDatabaseMixin } from '@/lib/database/sql/media'
import { MuteSQLDatabaseMixin } from '@/lib/database/sql/mute'
import { NotificationSQLDatabaseMixin } from '@/lib/database/sql/notification'
import { OAuthSQLDatabaseMixin } from '@/lib/database/sql/oauth'
import { PushSubscriptionSQLDatabaseMixin } from '@/lib/database/sql/pushSubscription'
import { RelaySQLDatabaseMixin } from '@/lib/database/sql/relay'
import { ReportSQLDatabaseMixin } from '@/lib/database/sql/report'
import { ScheduledStatusSQLDatabaseMixin } from '@/lib/database/sql/scheduledStatus'
import { SearchSQLDatabaseMixin } from '@/lib/database/sql/search'
import { ServerFilterSQLDatabaseMixin } from '@/lib/database/sql/serverFilter'
import { StatusSQLDatabaseMixin } from '@/lib/database/sql/status'
import { StatusDetectedLanguageSQLDatabaseMixin } from '@/lib/database/sql/statusDetectedLanguage'
import { StatusMuteSQLDatabaseMixin } from '@/lib/database/sql/statusMute'
import { StravaArchiveImportSQLDatabaseMixin } from '@/lib/database/sql/stravaArchiveImport'
import { SuggestionSQLDatabaseMixin } from '@/lib/database/sql/suggestion'
import { TimelineSQLDatabaseMixin } from '@/lib/database/sql/timeline'
import { TranslationCacheSQLDatabaseMixin } from '@/lib/database/sql/translationCache'
import { TrendsSQLDatabaseMixin } from '@/lib/database/sql/trends'
import { Database } from '@/lib/database/types'

export const getSQLDatabase = (database: Knex): Database => {
  const accountDatabase = AccountSQLDatabaseMixin(database)
  const accountNoteDatabase = AccountNoteSQLDatabaseMixin(database)
  const actorDatabase = ActorSQLDatabaseMixin(database)
  const adminDatabase = AdminSQLDatabaseMixin(database)
  const announcementDatabase = AnnouncementSQLDatabaseMixin(database)
  const fitnessFileDatabase = FitnessFileSQLDatabaseMixin(database)
  const fitnessRouteHeatmapDatabase =
    FitnessRouteHeatmapSQLDatabaseMixin(database)
  const fitnessSettingsDatabase = FitnessSettingsSQLDatabaseMixin(database)
  const importLockDatabase = ImportLockSQLDatabaseMixin(database)
  const bookmarkDatabase = BookmarkSQLDatabaseMixin(database)
  const blockDatabase = BlockSQLDatabaseMixin(database)
  const customEmojiDatabase = CustomEmojiSQLDatabaseMixin(database)
  const markerDatabase = MarkerSQLDatabaseMixin(database)
  const muteDatabase = MuteSQLDatabaseMixin(database)
  const endorsementDatabase = EndorsementSQLDatabaseMixin(database)
  const featuredTagDatabase = FeaturedTagSQLDatabaseMixin(database)
  const statusMuteDatabase = StatusMuteSQLDatabaseMixin(database)
  const idempotencyDatabase = IdempotencySQLDatabaseMixin(database)
  const translationCacheDatabase = TranslationCacheSQLDatabaseMixin(database)
  const statusDetectedLanguageDatabase =
    StatusDetectedLanguageSQLDatabaseMixin(database)
  const filterDatabase = FilterSQLDatabaseMixin(database)
  const serverFilterDatabase = ServerFilterSQLDatabaseMixin(database)
  const followerDatabase = FollowerSQLDatabaseMixin(database, actorDatabase)
  const followedTagDatabase = FollowedTagSQLDatabaseMixin(database)
  const instanceActivityDatabase = InstanceActivitySQLDatabaseMixin(database)
  const instanceRuleDatabase = InstanceRuleSQLDatabaseMixin(database)
  const likeDatabase = LikeSQLDatabaseMixin(database)
  const mediaDatabase = MediaSQLDatabaseMixin(database)
  const notificationDatabase = NotificationSQLDatabaseMixin(database)
  const pushSubscriptionDatabase = PushSubscriptionSQLDatabaseMixin(database)
  const relayDatabase = RelaySQLDatabaseMixin(database)
  const reportDatabase = ReportSQLDatabaseMixin(database)
  const scheduledStatusDatabase = ScheduledStatusSQLDatabaseMixin(database)
  const oauthDatabase = OAuthSQLDatabaseMixin(database)
  const searchDatabase = SearchSQLDatabaseMixin(database)
  const stravaArchiveImportDatabase =
    StravaArchiveImportSQLDatabaseMixin(database)
  const suggestionDatabase = SuggestionSQLDatabaseMixin(database)
  const trendsDatabase = TrendsSQLDatabaseMixin(database)
  const statusDatabase = StatusSQLDatabaseMixin(
    database,
    actorDatabase,
    likeDatabase,
    bookmarkDatabase,
    mediaDatabase,
    statusDetectedLanguageDatabase
  )
  const listDatabase = ListSQLDatabaseMixin(
    database,
    (actorIds) => actorDatabase.getMastodonActors(actorIds),
    // currentActorId hydrates the viewer's action state. getListTimeline
    // already enforces visibility on its own query (before LIMIT), so no
    // visibleToActorId is needed here.
    (statusIds, currentActorId) =>
      statusDatabase.getStatusesByIds({ statusIds, currentActorId })
  )
  const collectionDatabase = CollectionSQLDatabaseMixin(
    database,
    (actorIds) => actorDatabase.getMastodonActors(actorIds),
    // getCollectionTimeline enforces visibility on its own query (owner
    // projection) or restricts to public posts (public projection), so the
    // currentActorId here only hydrates the owner's action state.
    (statusIds, currentActorId) =>
      statusDatabase.getStatusesByIds({ statusIds, currentActorId })
  )
  const directConversationDatabase = DirectConversationSQLDatabaseMixin(
    database,
    statusDatabase
  )
  const timelineDatabase = TimelineSQLDatabaseMixin(database, statusDatabase)

  return {
    async migrate() {
      await database.migrate.latest({ disableTransactions: true })
    },

    async destroy() {
      await database.destroy()
    },

    ...accountDatabase,
    ...accountNoteDatabase,
    ...actorDatabase,
    ...adminDatabase,
    ...announcementDatabase,
    ...fitnessFileDatabase,
    ...fitnessRouteHeatmapDatabase,
    ...fitnessSettingsDatabase,
    ...importLockDatabase,
    ...instanceActivityDatabase,
    ...instanceRuleDatabase,
    ...bookmarkDatabase,
    ...blockDatabase,
    ...customEmojiDatabase,
    ...markerDatabase,
    ...muteDatabase,
    ...endorsementDatabase,
    ...featuredTagDatabase,
    ...statusMuteDatabase,
    ...idempotencyDatabase,
    ...translationCacheDatabase,
    ...statusDetectedLanguageDatabase,
    ...collectionDatabase,
    ...listDatabase,
    ...filterDatabase,
    ...serverFilterDatabase,
    ...followerDatabase,
    ...followedTagDatabase,
    ...likeDatabase,
    ...mediaDatabase,
    ...notificationDatabase,
    ...pushSubscriptionDatabase,
    ...relayDatabase,
    ...reportDatabase,
    ...scheduledStatusDatabase,
    ...oauthDatabase,
    ...searchDatabase,
    ...stravaArchiveImportDatabase,
    ...suggestionDatabase,
    ...trendsDatabase,
    ...statusDatabase,
    ...directConversationDatabase,

    ...timelineDatabase
  }
}
