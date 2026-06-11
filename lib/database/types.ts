import { FitnessFileDatabase } from '@/lib/database/sql/fitnessFile'
import { FitnessRouteHeatmapDatabase } from '@/lib/database/sql/fitnessRouteHeatmap'
import { FitnessSettingsDatabase } from '@/lib/database/sql/fitnessSettings'
import { StravaArchiveImportDatabase } from '@/lib/database/sql/stravaArchiveImport'
import {
  AccountDatabase,
  AccountNoteDatabase,
  ActorDatabase,
  AdminDatabase,
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
  LikeDatabase,
  ListDatabase,
  MarkerDatabase,
  MediaDatabase,
  MuteDatabase,
  NotificationDatabase,
  OAuthDatabase,
  PushSubscriptionDatabase,
  ReportDatabase,
  SearchDatabase,
  ServerFilterDatabase,
  StatusDatabase,
  StatusMuteDatabase,
  TimelineDatabase,
  TranslationCacheDatabase
} from '@/lib/types/database/operations'

export type Database = AccountDatabase &
  AccountNoteDatabase &
  ActorDatabase &
  AdminDatabase &
  InstanceActivityDatabase &
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
  ReportDatabase &
  SearchDatabase &
  StatusDatabase &
  StatusMuteDatabase &
  IdempotencyDatabase &
  TranslationCacheDatabase &
  TimelineDatabase &
  BaseDatabase
