import { Actor } from '../models/actor'
import { StatusData } from '../models/status'
import { Storage } from '../storage/types'

export enum Timeline {
  MAIN = 'main',
  NOANNOUNCE = 'noannounce',
  LocalPublic = 'local-public'
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

export type TimelineRule = MainTimelineRule | NoAnnounceTimelineRule
