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
  FollowDatabase,
  LikeDatabase,
  MediaDatabase,
  NotificationDatabase,
  OAuthDatabase,
  PushSubscriptionDatabase,
  StatusDatabase,
  TimelineDatabase
} from '@/lib/types/database/operations'

export type Database = AccountDatabase &
  ActorDatabase &
  AdminDatabase &
  FitnessFileDatabase &
  FitnessRouteHeatmapDatabase &
  FitnessSettingsDatabase &
  StravaArchiveImportDatabase &
  BookmarkDatabase &
  BlockDatabase &
  FollowDatabase &
  LikeDatabase &
  MediaDatabase &
  NotificationDatabase &
  OAuthDatabase &
  PushSubscriptionDatabase &
  StatusDatabase &
  TimelineDatabase &
  BaseDatabase
