import { AccountDatabase } from '@/lib/database/types/account'
import { ActorDatabase } from '@/lib/database/types/actor'
import { BaseDatabase } from '@/lib/database/types/base'
import { FollowDatabase } from '@/lib/database/types/follow'
import { LikeDatabase } from '@/lib/database/types/like'
import { MediaDatabase } from '@/lib/database/types/media'
import { NotificationDatabase } from '@/lib/database/types/notification'
import { OAuthDatabase } from '@/lib/database/types/oauth'
import { StatusDatabase } from '@/lib/database/types/status'
import { TimelineDatabase } from '@/lib/database/types/timeline'

export type Database = AccountDatabase &
  ActorDatabase &
  FollowDatabase &
  LikeDatabase &
  MediaDatabase &
  NotificationDatabase &
  OAuthDatabase &
  StatusDatabase &
  TimelineDatabase &
  BaseDatabase
