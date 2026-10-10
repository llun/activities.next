import { Knex } from 'knex'

import { accountNoteQueries } from '@/lib/database/domains/accountNote/queries'
import type { AccountNoteDatabase } from '@/lib/database/domains/accountNote/types'
import { actorDomainBlockQueries } from '@/lib/database/domains/actorDomainBlock/queries'
import type { ActorDomainBlockDatabase } from '@/lib/database/domains/actorDomainBlock/types'
import { customEmojiQueries } from '@/lib/database/domains/customEmoji/queries'
import type { CustomEmojiDatabase } from '@/lib/database/domains/customEmoji/types'
import { endorsementQueries } from '@/lib/database/domains/endorsement/queries'
import type { EndorsementDatabase } from '@/lib/database/domains/endorsement/types'
import { followedTagQueries } from '@/lib/database/domains/followedTag/queries'
import type { FollowedTagDatabase } from '@/lib/database/domains/followedTag/types'
import { idempotencyQueries } from '@/lib/database/domains/idempotency/queries'
import type { IdempotencyDatabase } from '@/lib/database/domains/idempotency/types'
import { importLockQueries } from '@/lib/database/domains/importLock/queries'
import type { ImportLockDatabase } from '@/lib/database/domains/importLock/types'
import { instanceRuleQueries } from '@/lib/database/domains/instanceRule/queries'
import type { InstanceRuleDatabase } from '@/lib/database/domains/instanceRule/types'
import { likeQueries } from '@/lib/database/domains/like/queries'
import type { LikeDatabase } from '@/lib/database/domains/like/types'
import { markerQueries } from '@/lib/database/domains/marker/queries'
import type { MarkerDatabase } from '@/lib/database/domains/marker/types'
import { relayQueries } from '@/lib/database/domains/relay/queries'
import type { RelayDatabase } from '@/lib/database/domains/relay/types'
import { serverSettingQueries } from '@/lib/database/domains/serverSetting/queries'
import type { ServerSettingDatabase } from '@/lib/database/domains/serverSetting/types'
import { translationCacheQueries } from '@/lib/database/domains/translationCache/queries'
import type { TranslationCacheDatabase } from '@/lib/database/domains/translationCache/types'
import {
  bindDb,
  installKnexKyselyGuard,
  kyselyFor
} from '@/lib/database/kysely'
import { AccountSQLDatabaseMixin } from '@/lib/database/sql/account'
import { ActorSQLDatabaseMixin } from '@/lib/database/sql/actor'
import { AdminSQLDatabaseMixin } from '@/lib/database/sql/admin'
import { AnnouncementSQLDatabaseMixin } from '@/lib/database/sql/announcement'
import { BlockSQLDatabaseMixin } from '@/lib/database/sql/block'
import { BookmarkSQLDatabaseMixin } from '@/lib/database/sql/bookmark'
import { CollectionSQLDatabaseMixin } from '@/lib/database/sql/collection'
import { DirectConversationSQLDatabaseMixin } from '@/lib/database/sql/conversation'
import { DeadLetterJobSQLDatabaseMixin } from '@/lib/database/sql/deadLetterJob'
import { FeaturedTagSQLDatabaseMixin } from '@/lib/database/sql/featuredTag'
import { FilterSQLDatabaseMixin } from '@/lib/database/sql/filter'
import { FitnessFileSQLDatabaseMixin } from '@/lib/database/sql/fitnessFile'
import { FitnessFileRouteSQLDatabaseMixin } from '@/lib/database/sql/fitnessFileRoute'
import { FitnessGearSQLDatabaseMixin } from '@/lib/database/sql/fitnessGear'
import { FitnessRouteHeatmapSQLDatabaseMixin } from '@/lib/database/sql/fitnessRouteHeatmap'
import { FitnessRouteHeatmapTileSQLDatabaseMixin } from '@/lib/database/sql/fitnessRouteHeatmapTile'
import { FitnessSettingsSQLDatabaseMixin } from '@/lib/database/sql/fitnessSettings'
import { FollowerSQLDatabaseMixin } from '@/lib/database/sql/follow'
import { GallerySQLDatabaseMixin } from '@/lib/database/sql/gallery'
import { GalleryAlbumSuggestionSQLDatabaseMixin } from '@/lib/database/sql/galleryAlbumSuggestions'
import { GalleryAlbumSQLDatabaseMixin } from '@/lib/database/sql/galleryAlbums'
import { GalleryLookupCacheSQLDatabaseMixin } from '@/lib/database/sql/galleryLookupCache'
import { GalleryMediaSQLDatabaseMixin } from '@/lib/database/sql/galleryMedia'
import { InstanceActivitySQLDatabaseMixin } from '@/lib/database/sql/instanceActivity'
import { LinkPreviewSQLDatabaseMixin } from '@/lib/database/sql/linkPreview'
import { ListSQLDatabaseMixin } from '@/lib/database/sql/list'
import { MediaSQLDatabaseMixin } from '@/lib/database/sql/media'
import { ModerationSQLDatabaseMixin } from '@/lib/database/sql/moderation'
import { MuteSQLDatabaseMixin } from '@/lib/database/sql/mute'
import { NotificationSQLDatabaseMixin } from '@/lib/database/sql/notification'
import { OAuthSQLDatabaseMixin } from '@/lib/database/sql/oauth'
import { PushSubscriptionSQLDatabaseMixin } from '@/lib/database/sql/pushSubscription'
import { QueueJobSQLDatabaseMixin } from '@/lib/database/sql/queueJob'
import { ReportSQLDatabaseMixin } from '@/lib/database/sql/report'
import { ScheduledStatusSQLDatabaseMixin } from '@/lib/database/sql/scheduledStatus'
import { SearchSQLDatabaseMixin } from '@/lib/database/sql/search'
import { ServerFilterSQLDatabaseMixin } from '@/lib/database/sql/serverFilter'
import { StatusSQLDatabaseMixin } from '@/lib/database/sql/status'
import { StatusDetectedLanguageSQLDatabaseMixin } from '@/lib/database/sql/statusDetectedLanguage'
import { StatusMuteSQLDatabaseMixin } from '@/lib/database/sql/statusMute'
import { StatusQuoteSQLDatabaseMixin } from '@/lib/database/sql/statusQuote'
import { StatusReactionSQLDatabaseMixin } from '@/lib/database/sql/statusReaction'
import { StravaArchiveImportSQLDatabaseMixin } from '@/lib/database/sql/stravaArchiveImport'
import { SuggestionSQLDatabaseMixin } from '@/lib/database/sql/suggestion'
import { TimelineSQLDatabaseMixin } from '@/lib/database/sql/timeline'
import { TrendsSQLDatabaseMixin } from '@/lib/database/sql/trends'
import { WahooImportSQLDatabaseMixin } from '@/lib/database/sql/wahooImport'
import { Database } from '@/lib/database/types'

export const getSQLDatabase = (database: Knex): Database => {
  // Track Knex transactions from the start, so a Kysely call inside one is
  // caught even if it is the first Kysely call (see lib/database/kysely/guard.ts).
  installKnexKyselyGuard(database)
  // Domains that have moved to Kysely. `kyselyFor` runs on first use, so a
  // mocked Knex without a client still builds the facade.
  const kysely = () => kyselyFor(database)
  const accountDatabase = AccountSQLDatabaseMixin(database)
  const accountNoteDatabase: AccountNoteDatabase = bindDb(
    kysely,
    accountNoteQueries
  )
  const actorDatabase = ActorSQLDatabaseMixin(database)
  const actorDomainBlockDatabase: ActorDomainBlockDatabase = bindDb(
    kysely,
    actorDomainBlockQueries
  )
  const adminDatabase = AdminSQLDatabaseMixin(database)
  const announcementDatabase = AnnouncementSQLDatabaseMixin(database)
  const fitnessFileDatabase = FitnessFileSQLDatabaseMixin(database)
  const fitnessFileRouteDatabase = FitnessFileRouteSQLDatabaseMixin(database)
  const fitnessGearDatabase = FitnessGearSQLDatabaseMixin(database)
  const fitnessRouteHeatmapDatabase =
    FitnessRouteHeatmapSQLDatabaseMixin(database)
  const fitnessRouteHeatmapTileDatabase =
    FitnessRouteHeatmapTileSQLDatabaseMixin(database)
  const fitnessSettingsDatabase = FitnessSettingsSQLDatabaseMixin(database)
  const galleryDatabase = GallerySQLDatabaseMixin(database)
  const galleryAlbumDatabase = GalleryAlbumSQLDatabaseMixin(database)
  const galleryAlbumSuggestionDatabase =
    GalleryAlbumSuggestionSQLDatabaseMixin(database)
  const galleryMediaDatabase = GalleryMediaSQLDatabaseMixin(database)
  const galleryLookupCacheDatabase =
    GalleryLookupCacheSQLDatabaseMixin(database)
  const importLockDatabase: ImportLockDatabase = bindDb(
    kysely,
    importLockQueries
  )
  const bookmarkDatabase = BookmarkSQLDatabaseMixin(database)
  const blockDatabase = BlockSQLDatabaseMixin(database)
  const customEmojiDatabase: CustomEmojiDatabase = bindDb(
    kysely,
    customEmojiQueries
  )
  const deadLetterJobDatabase = DeadLetterJobSQLDatabaseMixin(database)
  const markerDatabase: MarkerDatabase = bindDb(kysely, markerQueries)
  const muteDatabase = MuteSQLDatabaseMixin(database)
  const endorsementDatabase: EndorsementDatabase = bindDb(
    kysely,
    endorsementQueries
  )
  const featuredTagDatabase = FeaturedTagSQLDatabaseMixin(database)
  const statusMuteDatabase = StatusMuteSQLDatabaseMixin(database)
  const statusQuoteDatabase = StatusQuoteSQLDatabaseMixin(database)
  const statusReactionDatabase = StatusReactionSQLDatabaseMixin(database)
  const idempotencyDatabase: IdempotencyDatabase = bindDb(
    kysely,
    idempotencyQueries
  )
  const translationCacheDatabase: TranslationCacheDatabase = bindDb(
    kysely,
    translationCacheQueries
  )
  const statusDetectedLanguageDatabase =
    StatusDetectedLanguageSQLDatabaseMixin(database)
  const filterDatabase = FilterSQLDatabaseMixin(database)
  const serverFilterDatabase = ServerFilterSQLDatabaseMixin(database)
  const serverSettingDatabase: ServerSettingDatabase = bindDb(
    kysely,
    serverSettingQueries
  )
  const followerDatabase = FollowerSQLDatabaseMixin(database, actorDatabase)
  const followedTagDatabase: FollowedTagDatabase = bindDb(
    kysely,
    followedTagQueries
  )
  const instanceActivityDatabase = InstanceActivitySQLDatabaseMixin(database)
  const instanceRuleDatabase: InstanceRuleDatabase = bindDb(
    kysely,
    instanceRuleQueries
  )
  const likeDatabase: LikeDatabase = bindDb(kysely, likeQueries)
  const linkPreviewDatabase = LinkPreviewSQLDatabaseMixin(database)
  const mediaDatabase = MediaSQLDatabaseMixin(database)
  const moderationDatabase = ModerationSQLDatabaseMixin(database)
  const notificationDatabase = NotificationSQLDatabaseMixin(database)
  const pushSubscriptionDatabase = PushSubscriptionSQLDatabaseMixin(database)
  const queueJobDatabase = QueueJobSQLDatabaseMixin(database)
  const relayDatabase: RelayDatabase = bindDb(kysely, relayQueries)
  const reportDatabase = ReportSQLDatabaseMixin(database)
  const scheduledStatusDatabase = ScheduledStatusSQLDatabaseMixin(database)
  const oauthDatabase = OAuthSQLDatabaseMixin(database)
  const searchDatabase = SearchSQLDatabaseMixin(database)
  const stravaArchiveImportDatabase =
    StravaArchiveImportSQLDatabaseMixin(database)
  const wahooImportDatabase = WahooImportSQLDatabaseMixin(database)
  const suggestionDatabase = SuggestionSQLDatabaseMixin(database)
  const trendsDatabase = TrendsSQLDatabaseMixin(database)
  const statusDatabase = StatusSQLDatabaseMixin(
    database,
    actorDatabase,
    likeDatabase,
    bookmarkDatabase,
    mediaDatabase,
    statusDetectedLanguageDatabase,
    statusReactionDatabase,
    linkPreviewDatabase
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
    ...actorDomainBlockDatabase,
    ...adminDatabase,
    ...announcementDatabase,
    ...fitnessFileDatabase,
    ...fitnessFileRouteDatabase,
    ...fitnessGearDatabase,
    ...fitnessRouteHeatmapDatabase,
    ...fitnessRouteHeatmapTileDatabase,
    ...fitnessSettingsDatabase,
    ...galleryDatabase,
    ...galleryAlbumDatabase,
    ...galleryAlbumSuggestionDatabase,
    ...galleryMediaDatabase,
    ...galleryLookupCacheDatabase,
    ...importLockDatabase,
    ...linkPreviewDatabase,
    ...instanceActivityDatabase,
    ...instanceRuleDatabase,
    ...bookmarkDatabase,
    ...blockDatabase,
    ...customEmojiDatabase,
    ...deadLetterJobDatabase,
    ...markerDatabase,
    ...muteDatabase,
    ...endorsementDatabase,
    ...featuredTagDatabase,
    ...statusMuteDatabase,
    ...statusQuoteDatabase,
    ...statusReactionDatabase,
    ...idempotencyDatabase,
    ...translationCacheDatabase,
    ...statusDetectedLanguageDatabase,
    ...collectionDatabase,
    ...listDatabase,
    ...filterDatabase,
    ...serverFilterDatabase,
    ...serverSettingDatabase,
    ...followerDatabase,
    ...followedTagDatabase,
    ...likeDatabase,
    ...mediaDatabase,
    ...moderationDatabase,
    ...notificationDatabase,
    ...pushSubscriptionDatabase,
    ...queueJobDatabase,
    ...relayDatabase,
    ...reportDatabase,
    ...scheduledStatusDatabase,
    ...oauthDatabase,
    ...searchDatabase,
    ...stravaArchiveImportDatabase,
    ...wahooImportDatabase,
    ...suggestionDatabase,
    ...trendsDatabase,
    ...statusDatabase,
    ...directConversationDatabase,

    ...timelineDatabase
  }
}
