import { Knex } from 'knex'

import { accountQueries } from '@/lib/database/domains/account/queries'
import type { AccountDatabase } from '@/lib/database/domains/account/types'
import { accountNoteQueries } from '@/lib/database/domains/accountNote/queries'
import type { AccountNoteDatabase } from '@/lib/database/domains/accountNote/types'
import { actorQueries } from '@/lib/database/domains/actor/queries'
import { getActor } from '@/lib/database/domains/actor/rows'
import type { SQLActorDatabase } from '@/lib/database/domains/actor/types'
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
import { createCollectionQueries } from '@/lib/database/domains/collection/queries'
import type { CollectionDatabase } from '@/lib/database/domains/collection/types'
import { createConversationQueries } from '@/lib/database/domains/conversation/queries'
import type { DirectConversationDatabase } from '@/lib/database/domains/conversation/types'
import { customEmojiQueries } from '@/lib/database/domains/customEmoji/queries'
import type { CustomEmojiDatabase } from '@/lib/database/domains/customEmoji/types'
import { deadLetterJobQueries } from '@/lib/database/domains/deadLetterJob/queries'
import type { DeadLetterJobDatabase } from '@/lib/database/domains/deadLetterJob/types'
import { endorsementQueries } from '@/lib/database/domains/endorsement/queries'
import type { EndorsementDatabase } from '@/lib/database/domains/endorsement/types'
import { featuredTagQueries } from '@/lib/database/domains/featuredTag/queries'
import type { FeaturedTagDatabase } from '@/lib/database/domains/featuredTag/types'
import { filterQueries } from '@/lib/database/domains/filter/queries'
import type { FilterDatabase } from '@/lib/database/domains/filter/types'
import { fitnessFileQueries } from '@/lib/database/domains/fitnessFile/queries'
import type { FitnessFileDatabase } from '@/lib/database/domains/fitnessFile/types'
import { fitnessFileRouteQueries } from '@/lib/database/domains/fitnessFileRoute/queries'
import type { FitnessFileRouteDatabase } from '@/lib/database/domains/fitnessFileRoute/types'
import { fitnessGearQueries } from '@/lib/database/domains/fitnessGear/queries'
import type { FitnessGearDatabase } from '@/lib/database/domains/fitnessGear/types'
import { fitnessRouteHeatmapQueries } from '@/lib/database/domains/fitnessRouteHeatmap/queries'
import type { FitnessRouteHeatmapDatabase } from '@/lib/database/domains/fitnessRouteHeatmap/types'
import { fitnessRouteHeatmapTileQueries } from '@/lib/database/domains/fitnessRouteHeatmapTile/queries'
import type { FitnessRouteHeatmapTileDatabase } from '@/lib/database/domains/fitnessRouteHeatmapTile/types'
import { fitnessSettingsQueries } from '@/lib/database/domains/fitnessSettings/queries'
import type { FitnessSettingsDatabase } from '@/lib/database/domains/fitnessSettings/types'
import { followQueries } from '@/lib/database/domains/follow/queries'
import type { FollowDatabase } from '@/lib/database/domains/follow/types'
import { followedTagQueries } from '@/lib/database/domains/followedTag/queries'
import type { FollowedTagDatabase } from '@/lib/database/domains/followedTag/types'
import { galleryAlbumQueries } from '@/lib/database/domains/gallery/albums'
import { galleryQueries } from '@/lib/database/domains/gallery/queries'
import type {
  GalleryAlbumDatabase,
  GalleryAlbumSuggestionDatabase,
  GalleryDatabase,
  GalleryLookupCacheDatabase,
  GalleryMediaDatabase
} from '@/lib/database/domains/gallery/types'
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
import { createListQueries } from '@/lib/database/domains/list/queries'
import type { ListDatabase } from '@/lib/database/domains/list/types'
import { markerQueries } from '@/lib/database/domains/marker/queries'
import type { MarkerDatabase } from '@/lib/database/domains/marker/types'
import { mediaQueries } from '@/lib/database/domains/media/queries'
import type { MediaDatabase } from '@/lib/database/domains/media/types'
import { mediaEditQueries } from '@/lib/database/domains/mediaEdit/queries'
import type { MediaEditDatabase } from '@/lib/database/domains/mediaEdit/types'
import { moderationQueries } from '@/lib/database/domains/moderation/queries'
import type {
  AdminAccountDatabase,
  ModerationDatabase
} from '@/lib/database/domains/moderation/types'
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
import { statusQueries } from '@/lib/database/domains/status/queries'
import { statusDetectedLanguageQueries } from '@/lib/database/domains/statusDetectedLanguage/queries'
import type { StatusDetectedLanguageDatabase } from '@/lib/database/domains/statusDetectedLanguage/types'
import { statusMuteQueries } from '@/lib/database/domains/statusMute/queries'
import type { StatusMuteDatabase } from '@/lib/database/domains/statusMute/types'
import { statusQuoteQueries } from '@/lib/database/domains/statusQuote/queries'
import type { StatusQuoteDatabase } from '@/lib/database/domains/statusQuote/types'
import { statusReactionQueries } from '@/lib/database/domains/statusReaction/queries'
import type { StatusReactionDatabase } from '@/lib/database/domains/statusReaction/types'
import { stravaArchiveImportQueries } from '@/lib/database/domains/stravaArchiveImport/queries'
import type { StravaArchiveImportDatabase } from '@/lib/database/domains/stravaArchiveImport/types'
import { suggestionQueries } from '@/lib/database/domains/suggestion/queries'
import type { SuggestionDatabase } from '@/lib/database/domains/suggestion/types'
import { createTimelineQueries } from '@/lib/database/domains/timeline/queries'
import type { TimelineDatabase } from '@/lib/database/domains/timeline/types'
import { translationCacheQueries } from '@/lib/database/domains/translationCache/queries'
import type { TranslationCacheDatabase } from '@/lib/database/domains/translationCache/types'
import { trendsQueries } from '@/lib/database/domains/trends/queries'
import type { TrendsDatabase } from '@/lib/database/domains/trends/types'
import { wahooImportQueries } from '@/lib/database/domains/wahooImport/queries'
import type { WahooImportDatabase } from '@/lib/database/domains/wahooImport/types'
import {
  bindDb,
  installKnexKyselyGuard,
  kyselyFor
} from '@/lib/database/kysely'
import { Database } from '@/lib/database/types'
import type { StatusDatabase } from '@/lib/types/database/operations'

export const getSQLDatabase = (database: Knex): Database => {
  // Track Knex transactions from the start, so a Kysely call inside one is
  // caught even if it is the first Kysely call (see lib/database/kysely/guard.ts).
  installKnexKyselyGuard(database)
  // Domains that have moved to Kysely. `kyselyFor` runs on first use, so a
  // mocked Knex without a client still builds the facade.
  const kysely = () => kyselyFor(database)
  const accountDatabase: AccountDatabase = bindDb(kysely, accountQueries)
  const accountNoteDatabase: AccountNoteDatabase = bindDb(
    kysely,
    accountNoteQueries
  )
  // getActor is the pure row mapper (lib/database/domains/actor/rows.ts),
  // kept on the facade only for the facade's own tests.
  const actorDatabase: SQLActorDatabase = {
    ...bindDb(kysely, actorQueries),
    getActor
  }
  const actorDomainBlockDatabase: ActorDomainBlockDatabase = bindDb(
    kysely,
    actorDomainBlockQueries
  )
  const adminDatabase: AdminDatabase = bindDb(kysely, adminQueries)
  const announcementDatabase: AnnouncementDatabase = bindDb(
    kysely,
    announcementQueries
  )
  const fitnessFileDatabase: FitnessFileDatabase = bindDb(
    kysely,
    fitnessFileQueries
  )
  const fitnessFileRouteDatabase: FitnessFileRouteDatabase = bindDb(
    kysely,
    fitnessFileRouteQueries
  )
  const fitnessGearDatabase: FitnessGearDatabase = bindDb(
    kysely,
    fitnessGearQueries
  )
  const fitnessRouteHeatmapDatabase: FitnessRouteHeatmapDatabase = bindDb(
    kysely,
    fitnessRouteHeatmapQueries
  )
  const fitnessRouteHeatmapTileDatabase: FitnessRouteHeatmapTileDatabase =
    bindDb(kysely, fitnessRouteHeatmapTileQueries)
  const fitnessSettingsDatabase: FitnessSettingsDatabase = bindDb(
    kysely,
    fitnessSettingsQueries
  )
  // Gear, settings, the gallery media reads, the lookup cache and the album
  // suggestions' item read; the albums are bound below.
  const galleryDatabase: GalleryDatabase &
    GalleryMediaDatabase &
    GalleryLookupCacheDatabase &
    GalleryAlbumSuggestionDatabase = bindDb(kysely, galleryQueries)
  const galleryAlbumDatabase: GalleryAlbumDatabase = bindDb(
    kysely,
    galleryAlbumQueries
  )
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
  const featuredTagDatabase: FeaturedTagDatabase = bindDb(
    kysely,
    featuredTagQueries
  )
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
  const followerDatabase: FollowDatabase = bindDb(kysely, followQueries)
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
  const mediaDatabase: MediaDatabase = bindDb(kysely, mediaQueries)
  const mediaEditDatabase: MediaEditDatabase = bindDb(kysely, mediaEditQueries)
  const moderationDatabase: ModerationDatabase & AdminAccountDatabase = bindDb(
    kysely,
    moderationQueries
  )
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
  const searchDatabase: SearchDatabase = bindDb(kysely, searchQueries)
  const stravaArchiveImportDatabase: StravaArchiveImportDatabase = bindDb(
    kysely,
    stravaArchiveImportQueries
  )
  const wahooImportDatabase: WahooImportDatabase = bindDb(
    kysely,
    wahooImportQueries
  )
  const suggestionDatabase: SuggestionDatabase = bindDb(
    kysely,
    suggestionQueries
  )
  const trendsDatabase: TrendsDatabase = bindDb(kysely, trendsQueries)
  const statusDatabase: StatusDatabase = bindDb(kysely, statusQueries)
  // The list, collection and timeline feeds hydrate through the status
  // facade's getStatusesByIds (on the root Kysely instance), outside their
  // domains' transactions. currentActorId hydrates the viewer's action
  // state: each feed already enforces visibility on its own query (before
  // LIMIT), so no visibleToActorId is needed here.
  const getStatusesByIds = (statusIds: string[], currentActorId?: string) =>
    statusDatabase.getStatusesByIds({ statusIds, currentActorId })
  const listDatabase: ListDatabase = bindDb(
    kysely,
    createListQueries(getStatusesByIds)
  )
  const collectionDatabase: CollectionDatabase = bindDb(
    kysely,
    createCollectionQueries(getStatusesByIds)
  )
  // The reads hydrate through the status facade (on the root Kysely
  // instance), outside this domain's transactions.
  const directConversationDatabase: DirectConversationDatabase = bindDb(
    kysely,
    createConversationQueries(statusDatabase)
  )
  const timelineDatabase: TimelineDatabase = bindDb(
    kysely,
    createTimelineQueries(getStatusesByIds)
  )

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
    ...mediaEditDatabase,
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
