import { z } from 'zod'

import { Status } from '../models/status'
import { Tag } from '../models/tag'
import { Timeline } from '../timelines/types'
import { AccountStorage } from './types/acount'
import { ActorStorage } from './types/actor'
import { FollowerStorage } from './types/follower'
import { LikeStorage } from './types/like'
import { MediaStorage } from './types/media'
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

export const TagType = z.enum(['emoji', 'mention'])
export type TagType = z.infer<typeof TagType>

export type CreateTagParams = {
  statusId: string
  name: string
  type: TagType
  value?: string
}
export type GetTagsParams = {
  statusId: string
}

export interface Storage
  extends AccountStorage,
    ActorStorage,
    FollowerStorage,
    LikeStorage,
    MediaStorage,
    StatusStorage {
  getTimeline(params: GetTimelineParams): Promise<Status[]>
  createTimelineStatus(params: CreateTimelineStatusParams): Promise<void>

  createTag(params: CreateTagParams): Promise<Tag>
  getTags(params: GetTagsParams): Promise<Tag[]>

  destroy(): Promise<void>
}
