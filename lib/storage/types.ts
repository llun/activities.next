import { AccountStorage } from '@/lib/storage/types/acount'
import { ActorStorage } from '@/lib/storage/types/actor'
import { BaseStorage } from '@/lib/storage/types/base'
import { FollowStorage } from '@/lib/storage/types/follow'
import { LikeStorage } from '@/lib/storage/types/like'
import { MediaStorage } from '@/lib/storage/types/media'
import { OAuthStorage } from '@/lib/storage/types/oauth'
import { StatusStorage } from '@/lib/storage/types/status'
import { TimelineStorage } from '@/lib/storage/types/timeline'

export type Storage = AccountStorage &
  ActorStorage &
  FollowStorage &
  LikeStorage &
  MediaStorage &
  OAuthStorage &
  StatusStorage &
  TimelineStorage &
  BaseStorage
