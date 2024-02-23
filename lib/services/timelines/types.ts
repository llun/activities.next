import { Actor } from '@/lib/models/actor'
import { StatusData } from '@/lib/models/status'
import { Storage } from '@/lib/storage/types'

export enum Timeline {
  MAIN = 'main',
  NOANNOUNCE = 'noannounce',
  MENTION = 'mention',
  LOCAL_PUBLIC = 'local-public'
}

export interface TimelineRuleParams {
  storage: Storage
  currentActor: Actor
  status: StatusData
}

export type MainTimelineRule = (
  params: TimelineRuleParams
) => Promise<Timeline.MAIN | null>

export type NoAnnounceTimelineRule = (
  params: TimelineRuleParams
) => Promise<Timeline.NOANNOUNCE | null>

export type MentionTimelineRule = (
  params: TimelineRuleParams
) => Promise<Timeline.MENTION | null>

export type TimelineRule = MainTimelineRule | NoAnnounceTimelineRule
