import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'

export enum Timeline {
  MAIN = 'main',
  HOME = 'home',
  DIRECT = 'direct',
  LOCAL_PUBLIC = 'local-public',
  // The "whole known network" feed: remote public statuses ingested from
  // accepted relays, materialized into the `federated_timeline` table.
  FEDERATED_PUBLIC = 'federated-public'
}

// List feeds are materialized into the same `timelines` table as the fixed feeds
// above so the read is a single indexed partition scan (the shape that makes the
// home feed fast) rather than a live statuses⋈list_accounts join. The `timeline`
// column is a free-form string, so a list uses the key `list:<listId>` (scoped,
// like the fixed feeds, by the owner's actorId).
export const listTimelineKey = (listId: string): string => `list:${listId}`

// Collections do NOT share the `timelines` table; their feed lives in the
// dedicated `collection_timeline` table (compact bigint keys). The materialized
// feed is capped per collection so storage stays bounded regardless of how many
// posts the members produce — the most recent COLLECTION_FEED_MAX_ROWS entries
// are kept; older ones are trimmed. Mirrors Mastodon's capped home/list feeds.
export const COLLECTION_FEED_MAX_ROWS = 1000
// Trim only once a collection overshoots the cap by this slack, so eviction is
// batched (one DELETE per overshoot) rather than paid on every single insert.
export const COLLECTION_FEED_TRIM_SLACK = 100
// When a remote actor is added to a collection the instance actor follows them
// and backfills at most this many of their most recent posts, so the feed shows
// history immediately instead of waiting for new activity to federate in. Bounds
// the one-off federation traffic (and, under the in-process NoQueue, latency).
export const COLLECTION_BACKFILL_MAX_POSTS = 40

export interface TimelineRuleParams {
  database: Database
  currentActor: Actor
  status: Status
}

export type MainTimelineRule = (
  params: TimelineRuleParams
) => Promise<Timeline.MAIN | null>
