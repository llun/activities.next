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
  FitnessSettingsDatabase &
  FollowDatabase &
  LikeDatabase &
  MediaDatabase &
  NotificationDatabase &
  OAuthDatabase &
  StatusDatabase &
  TimelineDatabase &
  BaseDatabase
