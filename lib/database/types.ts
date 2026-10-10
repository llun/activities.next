import { ImportLockDatabase } from '@/lib/database/domains/importLock/types'
import { FitnessFileDatabase } from '@/lib/database/sql/fitnessFile'
import { FitnessFileRouteDatabase } from '@/lib/database/sql/fitnessFileRoute'
import { FitnessGearDatabase } from '@/lib/database/sql/fitnessGear'
import { FitnessRouteHeatmapDatabase } from '@/lib/database/sql/fitnessRouteHeatmap'
import { FitnessRouteHeatmapTileDatabase } from '@/lib/database/sql/fitnessRouteHeatmapTile'
import { FitnessSettingsDatabase } from '@/lib/database/sql/fitnessSettings'
import { GalleryDatabase } from '@/lib/database/sql/gallery'
import { GalleryAlbumSuggestionDatabase } from '@/lib/database/sql/galleryAlbumSuggestions'
import { GalleryAlbumDatabase } from '@/lib/database/sql/galleryAlbums'
import { GalleryLookupCacheDatabase } from '@/lib/database/sql/galleryLookupCache'
import { GalleryMediaDatabase } from '@/lib/database/sql/galleryMedia'
import { StravaArchiveImportDatabase } from '@/lib/database/sql/stravaArchiveImport'
import { WahooImportDatabase } from '@/lib/database/sql/wahooImport'
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
