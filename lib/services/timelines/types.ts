import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { Status } from '@/lib/models/status'

export enum Timeline {
  MAIN = 'main',
  HOME = 'home',
  NOANNOUNCE = 'noannounce',
  MENTION = 'mention',
  LOCAL_PUBLIC = 'local-public'
}

export interface TimelineRuleParams {
  database: Database
  currentActor: Actor
  status: Status
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
