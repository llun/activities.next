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
import { FitnessSettingsDatabase } from '@/lib/database/sql/fitnessSettings'

export type Database = AccountDatabase &
  ActorDatabase &
  FitnessSettingsDatabase &
  FollowDatabase &
  LikeDatabase &
  MediaDatabase &
  NotificationDatabase &
  OAuthDatabase &
  StatusDatabase &
  TimelineDatabase &
  BaseDatabase
