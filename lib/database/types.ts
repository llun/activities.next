import { FitnessFileDatabase } from '@/lib/database/domains/fitnessFile/types'
import { FitnessGearDatabase } from '@/lib/database/domains/fitnessGear/types'
import { FitnessSettingsDatabase } from '@/lib/database/domains/fitnessSettings/types'
import {
  GalleryAlbumSuggestionDatabase,
  GalleryDatabase,
  GalleryLookupCacheDatabase,
  GalleryMediaDatabase
} from '@/lib/database/domains/gallery/types'
import { ImportLockDatabase } from '@/lib/database/domains/importLock/types'
import { MediaEditDatabase } from '@/lib/database/domains/mediaEdit/types'
import { StravaArchiveImportDatabase } from '@/lib/database/domains/stravaArchiveImport/types'
import { WahooImportDatabase } from '@/lib/database/domains/wahooImport/types'
import { FitnessFileRouteDatabase } from '@/lib/database/sql/fitnessFileRoute'
import { FitnessRouteHeatmapDatabase } from '@/lib/database/sql/fitnessRouteHeatmap'
import { FitnessRouteHeatmapTileDatabase } from '@/lib/database/sql/fitnessRouteHeatmapTile'
import { GalleryAlbumDatabase } from '@/lib/database/sql/galleryAlbums'
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
  CollectionDatabase,
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
  AccountNoteDatabase &
  ActorDatabase &
  ActorDomainBlockDatabase &
  AdminDatabase &
  AnnouncementDatabase &
  InstanceActivityDatabase &
  InstanceRuleDatabase &
  FitnessFileDatabase &
  FitnessFileRouteDatabase &
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
  BlockDatabase &
  MuteDatabase &
  EndorsementDatabase &
  FeaturedTagDatabase &
  CollectionDatabase &
  ListDatabase &
  FollowedTagDatabase &
  FilterDatabase &
  ServerFilterDatabase &
  ServerSettingDatabase &
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
