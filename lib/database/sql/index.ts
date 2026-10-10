import { Knex } from 'knex'

import { accountNoteQueries } from '@/lib/database/domains/accountNote/queries'
import type { AccountNoteDatabase } from '@/lib/database/domains/accountNote/types'
import { actorDomainBlockQueries } from '@/lib/database/domains/actorDomainBlock/queries'
import type { ActorDomainBlockDatabase } from '@/lib/database/domains/actorDomainBlock/types'
import { adminQueries } from '@/lib/database/domains/admin/queries'
import type { AdminDatabase } from '@/lib/database/domains/admin/types'
import { announcementQueries } from '@/lib/database/domains/announcement/queries'
import type { AnnouncementDatabase } from '@/lib/database/domains/announcement/types'
import { blockQueries } from '@/lib/database/domains/block/queries'
import type { BlockDatabase } from '@/lib/database/domains/block/types'
import { bookmarkQueries } from '@/lib/database/domains/bookmark/queries'
import type { BookmarkDatabase } from '@/lib/database/domains/bookmark/types'
import { customEmojiQueries } from '@/lib/database/domains/customEmoji/queries'
import type { CustomEmojiDatabase } from '@/lib/database/domains/customEmoji/types'
import { deadLetterJobQueries } from '@/lib/database/domains/deadLetterJob/queries'
import type { DeadLetterJobDatabase } from '@/lib/database/domains/deadLetterJob/types'
import { endorsementQueries } from '@/lib/database/domains/endorsement/queries'
import type { EndorsementDatabase } from '@/lib/database/domains/endorsement/types'
import { filterQueries } from '@/lib/database/domains/filter/queries'
import type { FilterDatabase } from '@/lib/database/domains/filter/types'
import { followedTagQueries } from '@/lib/database/domains/followedTag/queries'
import type { FollowedTagDatabase } from '@/lib/database/domains/followedTag/types'
import { idempotencyQueries } from '@/lib/database/domains/idempotency/queries'
import type { IdempotencyDatabase } from '@/lib/database/domains/idempotency/types'
import { importLockQueries } from '@/lib/database/domains/importLock/queries'
import type { ImportLockDatabase } from '@/lib/database/domains/importLock/types'
import { instanceActivityQueries } from '@/lib/database/domains/instanceActivity/queries'
import type { InstanceActivityDatabase } from '@/lib/database/domains/instanceActivity/types'
import { instanceRuleQueries } from '@/lib/database/domains/instanceRule/queries'
import type { InstanceRuleDatabase } from '@/lib/database/domains/instanceRule/types'
import { likeQueries } from '@/lib/database/domains/like/queries'
import type { LikeDatabase } from '@/lib/database/domains/like/types'
import { linkPreviewQueries } from '@/lib/database/domains/linkPreview/queries'
import type { LinkPreviewDatabase } from '@/lib/database/domains/linkPreview/types'
import { markerQueries } from '@/lib/database/domains/marker/queries'
import type { MarkerDatabase } from '@/lib/database/domains/marker/types'
import { muteQueries } from '@/lib/database/domains/mute/queries'
import type { MuteDatabase } from '@/lib/database/domains/mute/types'
import { notificationQueries } from '@/lib/database/domains/notification/queries'
import type { NotificationDatabase } from '@/lib/database/domains/notification/types'
import { oauthQueries } from '@/lib/database/domains/oauth/queries'
import type { OAuthDatabase } from '@/lib/database/domains/oauth/types'
import { pushSubscriptionQueries } from '@/lib/database/domains/pushSubscription/queries'
import type { PushSubscriptionDatabase } from '@/lib/database/domains/pushSubscription/types'
import { queueJobQueries } from '@/lib/database/domains/queueJob/queries'
import type { QueueJobDatabase } from '@/lib/database/domains/queueJob/types'
import { relayQueries } from '@/lib/database/domains/relay/queries'
import type { RelayDatabase } from '@/lib/database/domains/relay/types'
import { reportQueries } from '@/lib/database/domains/report/queries'
import type { ReportDatabase } from '@/lib/database/domains/report/types'
import { scheduledStatusQueries } from '@/lib/database/domains/scheduledStatus/queries'
import type { ScheduledStatusDatabase } from '@/lib/database/domains/scheduledStatus/types'
import { searchQueries } from '@/lib/database/domains/search/queries'
import type { SearchDatabase } from '@/lib/database/domains/search/types'
import { serverFilterQueries } from '@/lib/database/domains/serverFilter/queries'
import type { ServerFilterDatabase } from '@/lib/database/domains/serverFilter/types'
import { serverSettingQueries } from '@/lib/database/domains/serverSetting/queries'
import type { ServerSettingDatabase } from '@/lib/database/domains/serverSetting/types'
import { statusDetectedLanguageQueries } from '@/lib/database/domains/statusDetectedLanguage/queries'
import type { StatusDetectedLanguageDatabase } from '@/lib/database/domains/statusDetectedLanguage/types'
import { statusMuteQueries } from '@/lib/database/domains/statusMute/queries'
import type { StatusMuteDatabase } from '@/lib/database/domains/statusMute/types'
import { statusQuoteQueries } from '@/lib/database/domains/statusQuote/queries'
import type { StatusQuoteDatabase } from '@/lib/database/domains/statusQuote/types'
import { statusReactionQueries } from '@/lib/database/domains/statusReaction/queries'
import type { StatusReactionDatabase } from '@/lib/database/domains/statusReaction/types'
import { suggestionQueries } from '@/lib/database/domains/suggestion/queries'
import type { SuggestionDatabase } from '@/lib/database/domains/suggestion/types'
import { translationCacheQueries } from '@/lib/database/domains/translationCache/queries'
import type { TranslationCacheDatabase } from '@/lib/database/domains/translationCache/types'
import {
  bindDb,
  installKnexKyselyGuard,
  kyselyFor
} from '@/lib/database/kysely'
import { AccountSQLDatabaseMixin } from '@/lib/database/sql/account'
import { ActorSQLDatabaseMixin } from '@/lib/database/sql/actor'
import { CollectionSQLDatabaseMixin } from '@/lib/database/sql/collection'
import { DirectConversationSQLDatabaseMixin } from '@/lib/database/sql/conversation'
import { FeaturedTagSQLDatabaseMixin } from '@/lib/database/sql/featuredTag'
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
import { ListSQLDatabaseMixin } from '@/lib/database/sql/list'
import { MediaSQLDatabaseMixin } from '@/lib/database/sql/media'
import { ModerationSQLDatabaseMixin } from '@/lib/database/sql/moderation'
import {
  deleteHashtagSearchDocument,
  indexHashtagSearchDocument,
  indexHashtagSearchDocuments,
  reindexSearchHashtags,
  searchHashtags
} from '@/lib/database/sql/search/hashtag'
import {
  deleteStatusSearchDocument,
  indexStatusSearchDocument,
  reindexSearchStatuses,
  searchStatusIds
} from '@/lib/database/sql/search/status'
import { StatusSQLDatabaseMixin } from '@/lib/database/sql/status'
import { StravaArchiveImportSQLDatabaseMixin } from '@/lib/database/sql/stravaArchiveImport'
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
  const adminDatabase: AdminDatabase = bindDb(kysely, adminQueries)
  const announcementDatabase: AnnouncementDatabase = bindDb(
    kysely,
    announcementQueries
  )
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
  const bookmarkDatabase: BookmarkDatabase = bindDb(kysely, bookmarkQueries)
  const blockDatabase: BlockDatabase = bindDb(kysely, blockQueries)
  const customEmojiDatabase: CustomEmojiDatabase = bindDb(
    kysely,
    customEmojiQueries
  )
  const deadLetterJobDatabase: DeadLetterJobDatabase = bindDb(
    kysely,
    deadLetterJobQueries
  )
  const markerDatabase: MarkerDatabase = bindDb(kysely, markerQueries)
  const muteDatabase: MuteDatabase = bindDb(kysely, muteQueries)
  const endorsementDatabase: EndorsementDatabase = bindDb(
    kysely,
    endorsementQueries
  )
  const featuredTagDatabase = FeaturedTagSQLDatabaseMixin(database)
  const statusMuteDatabase: StatusMuteDatabase = bindDb(
    kysely,
    statusMuteQueries
  )
  const statusQuoteDatabase: StatusQuoteDatabase = bindDb(
    kysely,
    statusQuoteQueries
  )
  const statusReactionDatabase: StatusReactionDatabase = bindDb(
    kysely,
    statusReactionQueries
  )
  const idempotencyDatabase: IdempotencyDatabase = bindDb(
    kysely,
    idempotencyQueries
  )
  const translationCacheDatabase: TranslationCacheDatabase = bindDb(
    kysely,
    translationCacheQueries
  )
  const statusDetectedLanguageDatabase: StatusDetectedLanguageDatabase = bindDb(
    kysely,
    statusDetectedLanguageQueries
  )
  const filterDatabase: FilterDatabase = bindDb(kysely, filterQueries)
  const serverFilterDatabase: ServerFilterDatabase = bindDb(
    kysely,
    serverFilterQueries
  )
  const serverSettingDatabase: ServerSettingDatabase = bindDb(
    kysely,
    serverSettingQueries
  )
  const followerDatabase = FollowerSQLDatabaseMixin(database, actorDatabase)
  const followedTagDatabase: FollowedTagDatabase = bindDb(
    kysely,
    followedTagQueries
  )
  const instanceActivityDatabase: InstanceActivityDatabase = bindDb(
    kysely,
    instanceActivityQueries
  )
  const instanceRuleDatabase: InstanceRuleDatabase = bindDb(
    kysely,
    instanceRuleQueries
  )
  const likeDatabase: LikeDatabase = bindDb(kysely, likeQueries)
  const linkPreviewDatabase: LinkPreviewDatabase = bindDb(
    kysely,
    linkPreviewQueries
  )
  const mediaDatabase = MediaSQLDatabaseMixin(database)
  const moderationDatabase = ModerationSQLDatabaseMixin(database)
  const notificationDatabase: NotificationDatabase = bindDb(
    kysely,
    notificationQueries
  )
  const pushSubscriptionDatabase: PushSubscriptionDatabase = bindDb(
    kysely,
    pushSubscriptionQueries
  )
  const queueJobDatabase: QueueJobDatabase = bindDb(kysely, queueJobQueries)
  const relayDatabase: RelayDatabase = bindDb(kysely, relayQueries)
  const reportDatabase: ReportDatabase = bindDb(kysely, reportQueries)
  const scheduledStatusDatabase: ScheduledStatusDatabase = bindDb(
    kysely,
    scheduledStatusQueries
  )
  const oauthDatabase: OAuthDatabase = bindDb(kysely, oauthQueries)
  // Search documents and account search run on Kysely; the hashtag and status
  // halves are still Knex (sql/search/hashtag.ts and status.ts).
  const searchDatabase: SearchDatabase = {
    ...bindDb(kysely, searchQueries),
    searchHashtags: (params) => searchHashtags(database, params),
    indexHashtagSearchDocument: (params) =>
      indexHashtagSearchDocument(database, params),
    indexHashtagSearchDocuments: (params) =>
      indexHashtagSearchDocuments(database, params),
    deleteHashtagSearchDocument: (params) =>
      deleteHashtagSearchDocument(database, params),
    reindexSearchHashtags: (params) => reindexSearchHashtags(database, params),
    searchStatusIds: (params) => searchStatusIds(database, params),
    indexStatusSearchDocument: (params) =>
      indexStatusSearchDocument(database, params),
    deleteStatusSearchDocument: (params) =>
      deleteStatusSearchDocument(database, params),
    reindexSearchStatuses: (params) => reindexSearchStatuses(database, params)
  }
  const stravaArchiveImportDatabase =
    StravaArchiveImportSQLDatabaseMixin(database)
  const wahooImportDatabase = WahooImportSQLDatabaseMixin(database)
  const suggestionDatabase: SuggestionDatabase = bindDb(
    kysely,
    suggestionQueries
  )
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
