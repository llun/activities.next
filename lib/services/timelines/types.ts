import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'

export enum Timeline {
  MAIN = 'main',
  HOME = 'home',
  NOANNOUNCE = 'noannounce',
  MENTION = 'mention',
  DIRECT = 'direct',
  LOCAL_PUBLIC = 'local-public'
}

// List feeds are materialized into the same `timelines` table as the fixed feeds
// above, keyed per list so the read is a single indexed partition scan (the same
// shape that makes the home feed fast) instead of a live statuses⋈list_accounts
// join. The `timeline` column is a free-form string, so a list uses the synthetic
// key `list:<listId>` (scoped, like the fixed feeds, by the owner's actorId).
// List feeds are materialized into the same `timelines` table as the fixed feeds
// above so the read is a single indexed partition scan (the shape that makes the
// home feed fast) rather than a live statuses⋈list_accounts join. The `timeline`
// column is a free-form string, so a list uses the key `list:<listId>` (scoped,
// like the fixed feeds, by the owner's actorId).
export const listTimelineKey = (listId: string): string => `list:${listId}`

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
