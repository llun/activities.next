import { AccountArchiveDatabase } from '@/lib/database/domains/accountArchive/types'
import { AccountExportDatabase } from '@/lib/database/domains/accountExport/types'
import { AccountImportDatabase } from '@/lib/database/domains/accountImport/types'
import { ActorHandleDatabase } from '@/lib/database/domains/actorHandle/types'
import { ActorMigrationDatabase } from '@/lib/database/domains/actorMigration/types'
import { BulkImportDatabase } from '@/lib/database/domains/bulkImport/types'
import { FitnessFileDatabase } from '@/lib/database/domains/fitnessFile/types'
import { FitnessFileRouteDatabase } from '@/lib/database/domains/fitnessFileRoute/types'
import { FitnessFileRouteDataDatabase } from '@/lib/database/domains/fitnessFileRouteData/types'
import { FitnessGearDatabase } from '@/lib/database/domains/fitnessGear/types'
import { FitnessRouteHeatmapDatabase } from '@/lib/database/domains/fitnessRouteHeatmap/types'
import { FitnessRouteHeatmapTileDatabase } from '@/lib/database/domains/fitnessRouteHeatmapTile/types'
import { FitnessSettingsDatabase } from '@/lib/database/domains/fitnessSettings/types'
import {
  GalleryAlbumDatabase,
  GalleryAlbumSuggestionDatabase,
  GalleryDatabase,
  GalleryLookupCacheDatabase,
  GalleryMediaDatabase
} from '@/lib/database/domains/gallery/types'
import { ImportLockDatabase } from '@/lib/database/domains/importLock/types'
import { MediaEditDatabase } from '@/lib/database/domains/mediaEdit/types'
import { ServedDomainDatabase } from '@/lib/database/domains/servedDomain/types'
import { StravaArchiveImportDatabase } from '@/lib/database/domains/stravaArchiveImport/types'
import { WahooImportDatabase } from '@/lib/database/domains/wahooImport/types'
import {
  AccountDatabase,
  AccountNoteDatabase,
  ActorDatabase,
  ActorDomainBlockDatabase,
  AdminAccountDatabase,
  AdminDatabase,
  AnnouncementDatabase,
  BaseDatabase,
  BlockDatabase,
  BookmarkDatabase,
  CustomEmojiDatabase,
  DeadLetterJobDatabase,
  DirectConversationDatabase,
  EndorsementDatabase,
  FeaturedTagDatabase,
  FilterDatabase,
  FollowDatabase,
  FollowedTagDatabase,
  IdempotencyDatabase,
  InstanceActivityDatabase,
  InstanceRuleDatabase,
  LikeDatabase,
  LinkPreviewDatabase,
  ListDatabase,
  MarkerDatabase,
  MediaDatabase,
  ModerationDatabase,
  MuteDatabase,
  NotificationDatabase,
  OAuthDatabase,
  PushSubscriptionDatabase,
  QueueJobDatabase,
  RelayDatabase,
  ReportDatabase,
  ScheduledStatusDatabase,
  SearchDatabase,
  ServerFilterDatabase,
  ServerSettingDatabase,
  StatusDatabase,
  StatusDetectedLanguageDatabase,
  StatusMuteDatabase,
  StatusQuoteDatabase,
  StatusReactionDatabase,
  SuggestionDatabase,
  TimelineDatabase,
  TranslationCacheDatabase,
  TrendsDatabase
} from '@/lib/types/database/operations'

export type Database = AccountDatabase &
  AccountArchiveDatabase &
  AccountImportDatabase &
  AccountExportDatabase &
  AccountNoteDatabase &
  ActorDatabase &
  ActorDomainBlockDatabase &
  AdminDatabase &
  AnnouncementDatabase &
  InstanceActivityDatabase &
  InstanceRuleDatabase &
  FitnessFileDatabase &
  FitnessFileRouteDatabase &
  FitnessFileRouteDataDatabase &
  FitnessGearDatabase &
  FitnessRouteHeatmapDatabase &
  FitnessRouteHeatmapTileDatabase &
  FitnessSettingsDatabase &
  GalleryDatabase &
  GalleryAlbumDatabase &
  GalleryAlbumSuggestionDatabase &
  GalleryMediaDatabase &
  GalleryLookupCacheDatabase &
  ImportLockDatabase &
  StravaArchiveImportDatabase &
  WahooImportDatabase &
  BulkImportDatabase &
  ActorMigrationDatabase &
  ActorHandleDatabase &
  BlockDatabase &
  MuteDatabase &
  EndorsementDatabase &
  FeaturedTagDatabase &
  ListDatabase &
  FollowedTagDatabase &
  FilterDatabase &
  ServerFilterDatabase &
  ServerSettingDatabase &
  ServedDomainDatabase &
  BookmarkDatabase &
  CustomEmojiDatabase &
  DeadLetterJobDatabase &
  DirectConversationDatabase &
  FollowDatabase &
  LikeDatabase &
  LinkPreviewDatabase &
  MarkerDatabase &
  MediaDatabase &
  MediaEditDatabase &
  NotificationDatabase &
  OAuthDatabase &
  PushSubscriptionDatabase &
  QueueJobDatabase &
  RelayDatabase &
  ReportDatabase &
  ModerationDatabase &
  AdminAccountDatabase &
  ScheduledStatusDatabase &
  SearchDatabase &
  StatusDatabase &
  StatusDetectedLanguageDatabase &
  StatusMuteDatabase &
  StatusQuoteDatabase &
  StatusReactionDatabase &
  SuggestionDatabase &
  TrendsDatabase &
  IdempotencyDatabase &
  TranslationCacheDatabase &
  TimelineDatabase &
  BaseDatabase
