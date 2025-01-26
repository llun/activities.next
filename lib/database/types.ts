import { AccountStorage } from '@/lib/database/types/acount'
import { ActorStorage } from '@/lib/database/types/actor'
import { BaseStorage } from '@/lib/database/types/base'
import { FollowStorage } from '@/lib/database/types/follow'
import { LikeStorage } from '@/lib/database/types/like'
import { MediaStorage } from '@/lib/database/types/media'
import { OAuthStorage } from '@/lib/database/types/oauth'
import { StatusStorage } from '@/lib/database/types/status'
import { TimelineStorage } from '@/lib/database/types/timeline'

export type Storage = AccountStorage &
  ActorStorage &
  FollowStorage &
  LikeStorage &
  MediaStorage &
  OAuthStorage &
  StatusStorage &
  TimelineStorage &
  BaseStorage
