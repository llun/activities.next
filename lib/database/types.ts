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
  DirectConversationDatabase,
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
  StatusDatabase,
  StatusMuteDatabase,
  TimelineDatabase
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
  ListDatabase &
  FollowedTagDatabase &
  FilterDatabase &
  BookmarkDatabase &
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
  TimelineDatabase &
  BaseDatabase
