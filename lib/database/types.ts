import { FitnessFileDatabase } from '@/lib/database/sql/fitnessFile'
import { FitnessRouteHeatmapDatabase } from '@/lib/database/sql/fitnessRouteHeatmap'
import { FitnessSettingsDatabase } from '@/lib/database/sql/fitnessSettings'
import { ImportLockDatabase } from '@/lib/database/sql/importLock'
import { StravaArchiveImportDatabase } from '@/lib/database/sql/stravaArchiveImport'
import {
  AccountDatabase,
  AccountNoteDatabase,
  ActorDatabase,
  AdminDatabase,
  AnnouncementDatabase,
  BaseDatabase,
  BlockDatabase,
  BookmarkDatabase,
  CollectionDatabase,
  CustomEmojiDatabase,
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
  ListDatabase,
  MarkerDatabase,
  MediaDatabase,
  MuteDatabase,
  NotificationDatabase,
  OAuthDatabase,
  PushSubscriptionDatabase,
  RelayDatabase,
  ReportDatabase,
  ScheduledStatusDatabase,
  SearchDatabase,
  ServerFilterDatabase,
  StatusDatabase,
  StatusDetectedLanguageDatabase,
  StatusMuteDatabase,
  SuggestionDatabase,
  TimelineDatabase,
  TranslationCacheDatabase,
  TrendsDatabase
} from '@/lib/types/database/operations'

export type Database = AccountDatabase &
  AccountNoteDatabase &
  ActorDatabase &
  AdminDatabase &
  AnnouncementDatabase &
  InstanceActivityDatabase &
  InstanceRuleDatabase &
  FitnessFileDatabase &
  FitnessRouteHeatmapDatabase &
  FitnessSettingsDatabase &
  ImportLockDatabase &
  StravaArchiveImportDatabase &
  BlockDatabase &
  MuteDatabase &
  EndorsementDatabase &
  FeaturedTagDatabase &
  CollectionDatabase &
  ListDatabase &
  FollowedTagDatabase &
  FilterDatabase &
  ServerFilterDatabase &
  BookmarkDatabase &
  CustomEmojiDatabase &
  DirectConversationDatabase &
  FollowDatabase &
  LikeDatabase &
  MarkerDatabase &
  MediaDatabase &
  NotificationDatabase &
  OAuthDatabase &
  PushSubscriptionDatabase &
  RelayDatabase &
  ReportDatabase &
  ScheduledStatusDatabase &
  SearchDatabase &
  StatusDatabase &
  StatusDetectedLanguageDatabase &
  StatusMuteDatabase &
  SuggestionDatabase &
  TrendsDatabase &
  IdempotencyDatabase &
  TranslationCacheDatabase &
  TimelineDatabase &
  BaseDatabase
