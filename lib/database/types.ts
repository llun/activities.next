import { FitnessFileDatabase } from '@/lib/database/sql/fitnessFile'
import { FitnessRouteHeatmapDatabase } from '@/lib/database/sql/fitnessRouteHeatmap'
import { FitnessSettingsDatabase } from '@/lib/database/sql/fitnessSettings'
import { StravaArchiveImportDatabase } from '@/lib/database/sql/stravaArchiveImport'
import {
  AccountDatabase,
  ActorDatabase,
  AdminDatabase,
  BaseDatabase,
  BlockDatabase,
  BookmarkDatabase,
  DirectConversationDatabase,
  FilterDatabase,
  FollowDatabase,
  InstanceActivityDatabase,
  LikeDatabase,
  MarkerDatabase,
  MediaDatabase,
  MuteDatabase,
  NotificationDatabase,
  OAuthDatabase,
  PushSubscriptionDatabase,
  SearchDatabase,
  StatusDatabase,
  TimelineDatabase
} from '@/lib/types/database/operations'

export type Database = AccountDatabase &
  ActorDatabase &
  AdminDatabase &
  InstanceActivityDatabase &
  FitnessFileDatabase &
  FitnessRouteHeatmapDatabase &
  FitnessSettingsDatabase &
  StravaArchiveImportDatabase &
  BlockDatabase &
  MuteDatabase &
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
  SearchDatabase &
  StatusDatabase &
  TimelineDatabase &
  BaseDatabase
