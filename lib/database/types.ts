import { FitnessFileDatabase } from '@/lib/database/sql/fitnessFile'
import { FitnessSettingsDatabase } from '@/lib/database/sql/fitnessSettings'
import {
  AccountDatabase,
  ActorDatabase,
  BaseDatabase,
  FollowDatabase,
  LikeDatabase,
  MediaDatabase,
  NotificationDatabase,
  OAuthDatabase,
  StatusDatabase,
  TimelineDatabase
} from '@/lib/types/database/operations'

export type Database = AccountDatabase &
  ActorDatabase &
  FitnessFileDatabase &
  FitnessSettingsDatabase &
  FollowDatabase &
  LikeDatabase &
  MediaDatabase &
  NotificationDatabase &
  OAuthDatabase &
  StatusDatabase &
  TimelineDatabase &
  BaseDatabase
