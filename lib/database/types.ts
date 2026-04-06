import { FitnessFileDatabase } from '@/lib/database/sql/fitnessFile'
import { FitnessHeatmapDatabase } from '@/lib/database/sql/fitnessHeatmap'
import { FitnessSettingsDatabase } from '@/lib/database/sql/fitnessSettings'
import { StravaArchiveImportDatabase } from '@/lib/database/sql/stravaArchiveImport'
import {
  AccountDatabase,
  ActorDatabase,
  AdminDatabase,
  BaseDatabase,
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
  FitnessHeatmapDatabase &
  FitnessSettingsDatabase &
  StravaArchiveImportDatabase &
  FollowDatabase &
  LikeDatabase &
  MediaDatabase &
  NotificationDatabase &
  OAuthDatabase &
  PushSubscriptionDatabase &
  StatusDatabase &
  TimelineDatabase &
  BaseDatabase
