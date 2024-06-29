import { Status } from '@/lib/models/status'
import { Timeline } from '@/lib/services/timelines/types'

import { AccountStorage } from './types/acount'
import { ActorStorage } from './types/actor'
import { BaseStorage } from './types/base'
import { FollowerStorage } from './types/follower'
import { LikeStorage } from './types/like'
import { MediaStorage } from './types/media'
import { OAuthStorage } from './types/oauth'
import { StatusStorage } from './types/status'

export type GetTimelineParams = {
  timeline: Timeline
  actorId?: string
  startAfterStatusId?: string | null
}
export type CreateTimelineStatusParams = {
  timeline: Timeline
  actorId: string
  status: Status
}

export interface Storage
  extends AccountStorage,
    ActorStorage,
    FollowerStorage,
    LikeStorage,
    MediaStorage,
    StatusStorage,
    OAuthStorage,
    BaseStorage {
  getTimeline(params: GetTimelineParams): Promise<Status[]>
  createTimelineStatus(params: CreateTimelineStatusParams): Promise<void>
}
