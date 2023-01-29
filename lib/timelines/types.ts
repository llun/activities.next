import { Actor } from '../models/actor'
import { Status } from '../models/status'
import { Storage } from '../storage/types'

export enum Timeline {
  MAIN = 'main'
}

interface TimelineRuleParams {
  storage: Storage
  currentActor: Actor
  status: Status
}

export type MainTimelineRule = (
  params: TimelineRuleParams
) => Promise<Timeline.MAIN | null>

export type TimelineRule = MainTimelineRule
