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
  TemporaryStatusDatabase,
  TimelineDatabase
} from '@/lib/types/database/operations'

export type Database = AccountDatabase &
  ActorDatabase &
  FollowDatabase &
  LikeDatabase &
  MediaDatabase &
  NotificationDatabase &
  OAuthDatabase &
  StatusDatabase &
  TemporaryStatusDatabase &
  TimelineDatabase &
  BaseDatabase
