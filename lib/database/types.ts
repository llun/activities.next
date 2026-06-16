import { FitnessFileDatabase } from '@/lib/database/sql/fitnessFile'
import { FitnessRouteHeatmapDatabase } from '@/lib/database/sql/fitnessRouteHeatmap'
import { FitnessSettingsDatabase } from '@/lib/database/sql/fitnessSettings'
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
  StravaArchiveImportDatabase &
  BlockDatabase &
  MuteDatabase &
  EndorsementDatabase &
  FeaturedTagDatabase &
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
  StatusMuteDatabase &
  SuggestionDatabase &
  TrendsDatabase &
  IdempotencyDatabase &
  TranslationCacheDatabase &
  TimelineDatabase &
  BaseDatabase
