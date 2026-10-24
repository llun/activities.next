import type { Kysely } from 'kysely'

import { accountQueries } from '@/lib/database/domains/account/queries'
import { accountArchiveQueries } from '@/lib/database/domains/accountArchive/queries'
import { accountExportQueries } from '@/lib/database/domains/accountExport/queries'
import { accountNoteQueries } from '@/lib/database/domains/accountNote/queries'
import { actorQueries } from '@/lib/database/domains/actor/queries'
import type { SQLActorDatabase } from '@/lib/database/domains/actor/types'
import { actorDomainBlockQueries } from '@/lib/database/domains/actorDomainBlock/queries'
import { actorMigrationQueries } from '@/lib/database/domains/actorMigration/queries'
import { adminQueries } from '@/lib/database/domains/admin/queries'
import { announcementQueries } from '@/lib/database/domains/announcement/queries'
import { blockQueries } from '@/lib/database/domains/block/queries'
import { bookmarkQueries } from '@/lib/database/domains/bookmark/queries'
import { bulkImportQueries } from '@/lib/database/domains/bulkImport/queries'
import { createConversationQueries } from '@/lib/database/domains/conversation/queries'
import { customEmojiQueries } from '@/lib/database/domains/customEmoji/queries'
import { deadLetterJobQueries } from '@/lib/database/domains/deadLetterJob/queries'
import { endorsementQueries } from '@/lib/database/domains/endorsement/queries'
import { featuredTagQueries } from '@/lib/database/domains/featuredTag/queries'
import { filterQueries } from '@/lib/database/domains/filter/queries'
import { fitnessFileQueries } from '@/lib/database/domains/fitnessFile/queries'
import { fitnessFileRouteQueries } from '@/lib/database/domains/fitnessFileRoute/queries'
import { fitnessFileRouteDataQueries } from '@/lib/database/domains/fitnessFileRouteData/queries'
import { fitnessGearQueries } from '@/lib/database/domains/fitnessGear/queries'
import { fitnessRouteHeatmapQueries } from '@/lib/database/domains/fitnessRouteHeatmap/queries'
import { fitnessRouteHeatmapTileQueries } from '@/lib/database/domains/fitnessRouteHeatmapTile/queries'
import { fitnessSettingsQueries } from '@/lib/database/domains/fitnessSettings/queries'
import { followQueries } from '@/lib/database/domains/follow/queries'
import { followedTagQueries } from '@/lib/database/domains/followedTag/queries'
import { galleryAlbumQueries } from '@/lib/database/domains/gallery/albums'
import { galleryQueries } from '@/lib/database/domains/gallery/queries'
import { idempotencyQueries } from '@/lib/database/domains/idempotency/queries'
import { importLockQueries } from '@/lib/database/domains/importLock/queries'
import { instanceActivityQueries } from '@/lib/database/domains/instanceActivity/queries'
import { instanceRuleQueries } from '@/lib/database/domains/instanceRule/queries'
import { likeQueries } from '@/lib/database/domains/like/queries'
import { linkPreviewQueries } from '@/lib/database/domains/linkPreview/queries'
import { createListQueries } from '@/lib/database/domains/list/queries'
import { markerQueries } from '@/lib/database/domains/marker/queries'
import { mediaQueries } from '@/lib/database/domains/media/queries'
import { mediaEditQueries } from '@/lib/database/domains/mediaEdit/queries'
import { moderationQueries } from '@/lib/database/domains/moderation/queries'
import { muteQueries } from '@/lib/database/domains/mute/queries'
import { notificationQueries } from '@/lib/database/domains/notification/queries'
import { oauthQueries } from '@/lib/database/domains/oauth/queries'
import { pushSubscriptionQueries } from '@/lib/database/domains/pushSubscription/queries'
import { queueJobQueries } from '@/lib/database/domains/queueJob/queries'
import { relayQueries } from '@/lib/database/domains/relay/queries'
import { reportQueries } from '@/lib/database/domains/report/queries'
import { scheduledStatusQueries } from '@/lib/database/domains/scheduledStatus/queries'
import { searchQueries } from '@/lib/database/domains/search/queries'
import { servedDomainQueries } from '@/lib/database/domains/servedDomain/queries'
import { serverFilterQueries } from '@/lib/database/domains/serverFilter/queries'
import { serverSettingQueries } from '@/lib/database/domains/serverSetting/queries'
import { statusQueries } from '@/lib/database/domains/status/queries'
import { statusDetectedLanguageQueries } from '@/lib/database/domains/statusDetectedLanguage/queries'
import { statusMuteQueries } from '@/lib/database/domains/statusMute/queries'
import { statusQuoteQueries } from '@/lib/database/domains/statusQuote/queries'
import { statusReactionQueries } from '@/lib/database/domains/statusReaction/queries'
import { stravaArchiveImportQueries } from '@/lib/database/domains/stravaArchiveImport/queries'
import { suggestionQueries } from '@/lib/database/domains/suggestion/queries'
import { createTimelineQueries } from '@/lib/database/domains/timeline/queries'
import { translationCacheQueries } from '@/lib/database/domains/translationCache/queries'
import { trendsQueries } from '@/lib/database/domains/trends/queries'
import { wahooImportQueries } from '@/lib/database/domains/wahooImport/queries'
import { type DB, bindDb } from '@/lib/database/kysely'
import type { Database } from '@/lib/database/types'

export type SQLDatabaseOptions = {
  /**
   * What `migrate()` runs. Without it `migrate()` throws: migrations run from
   * `yarn migrate`, and the test databases load the schema dump instead.
   */
  migrate?: () => Promise<void>
  /**
   * What `destroy()` runs; `db.destroy()` without it. The connection's own
   * destroy (lib/database/connection.ts) also refuses later queries when
   * nothing had connected yet, which Kysely's alone does not.
   */
  destroy?: () => Promise<void>
}

// The facade: every domain's queries bound to the root Kysely instance `db`.
// `destroy()` closes the connection behind it.
export const getSQLDatabase = (
  db: Kysely<DB>,
  { migrate, destroy }: SQLDatabaseOptions = {}
): Database => {
  const kysely = () => db
  const statusDatabase = bindDb(kysely, statusQueries)
  // The list and timeline feeds hydrate through the status
  // facade's getStatusesByIds (on the root Kysely instance), outside their
  // domains' transactions. currentActorId hydrates the viewer's action
  // state: each feed already enforces visibility on its own query (before
  // LIMIT), so no visibleToActorId is needed here.
  const getStatusesByIds = (statusIds: string[], currentActorId?: string) =>
    statusDatabase.getStatusesByIds({ statusIds, currentActorId })

  return {
    async migrate() {
      if (!migrate) {
        throw new Error(
          'migrate() is not available on this database; run `yarn migrate`'
        )
      }
      await migrate()
    },

    async destroy() {
      await (destroy ? destroy() : db.destroy())
    },

    ...bindDb(kysely, accountQueries),
    ...bindDb(kysely, accountArchiveQueries),
    ...bindDb(kysely, accountExportQueries),
    ...bindDb(kysely, accountNoteQueries),
    // Not in `Database`: the Mastodon Account lookups (`getMastodonActor(s)`)
    // are checked against SQLActorDatabase here.
    ...(bindDb(kysely, actorQueries) satisfies SQLActorDatabase),
    ...bindDb(kysely, actorDomainBlockQueries),
    ...bindDb(kysely, adminQueries),
    ...bindDb(kysely, announcementQueries),
    ...bindDb(kysely, fitnessFileQueries),
    ...bindDb(kysely, fitnessFileRouteQueries),
    ...bindDb(kysely, fitnessFileRouteDataQueries),
    ...bindDb(kysely, fitnessGearQueries),
    ...bindDb(kysely, fitnessRouteHeatmapQueries),
    ...bindDb(kysely, fitnessRouteHeatmapTileQueries),
    ...bindDb(kysely, fitnessSettingsQueries),
    // Gear, settings, the gallery media reads, the lookup cache and the album
    // suggestions' item read; the albums are the next line.
    ...bindDb(kysely, galleryQueries),
    ...bindDb(kysely, galleryAlbumQueries),
    ...bindDb(kysely, importLockQueries),
    ...bindDb(kysely, linkPreviewQueries),
    ...bindDb(kysely, instanceActivityQueries),
    ...bindDb(kysely, instanceRuleQueries),
    ...bindDb(kysely, bookmarkQueries),
    ...bindDb(kysely, blockQueries),
    ...bindDb(kysely, customEmojiQueries),
    ...bindDb(kysely, deadLetterJobQueries),
    ...bindDb(kysely, markerQueries),
    ...bindDb(kysely, muteQueries),
    ...bindDb(kysely, endorsementQueries),
    ...bindDb(kysely, featuredTagQueries),
    ...bindDb(kysely, statusMuteQueries),
    ...bindDb(kysely, statusQuoteQueries),
    ...bindDb(kysely, statusReactionQueries),
    ...bindDb(kysely, idempotencyQueries),
    ...bindDb(kysely, translationCacheQueries),
    ...bindDb(kysely, statusDetectedLanguageQueries),
    ...bindDb(kysely, createListQueries(getStatusesByIds)),
    ...bindDb(kysely, filterQueries),
    ...bindDb(kysely, serverFilterQueries),
    ...bindDb(kysely, serverSettingQueries),
    ...bindDb(kysely, servedDomainQueries),
    ...bindDb(kysely, followQueries),
    ...bindDb(kysely, followedTagQueries),
    ...bindDb(kysely, likeQueries),
    ...bindDb(kysely, mediaQueries),
    ...bindDb(kysely, mediaEditQueries),
    ...bindDb(kysely, moderationQueries),
    ...bindDb(kysely, notificationQueries),
    ...bindDb(kysely, pushSubscriptionQueries),
    ...bindDb(kysely, queueJobQueries),
    ...bindDb(kysely, relayQueries),
    ...bindDb(kysely, reportQueries),
    ...bindDb(kysely, scheduledStatusQueries),
    ...bindDb(kysely, oauthQueries),
    ...bindDb(kysely, searchQueries),
    ...bindDb(kysely, stravaArchiveImportQueries),
    ...bindDb(kysely, wahooImportQueries),
    ...bindDb(kysely, bulkImportQueries),
    ...bindDb(kysely, actorMigrationQueries),
    ...bindDb(kysely, suggestionQueries),
    ...bindDb(kysely, trendsQueries),
    ...statusDatabase,
    // The conversation reads hydrate through the status facade (on the root
    // Kysely instance), outside this domain's transactions.
    ...bindDb(kysely, createConversationQueries(statusDatabase)),
    ...bindDb(kysely, createTimelineQueries(getStatusesByIds))
  }
}
