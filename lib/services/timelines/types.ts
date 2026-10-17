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

// A list owner may add themselves to their own list (Mastodon ≥ 3.1) so the
// list shows their posts too. Only their most recent posts are backfilled when
// they do; posts written afterwards fan in like any member's. Mastodon
// backfills none of the owner's history: before 4.4 it backfills no member,
// and since then its merge runs only for follow-backed memberships, capped at
// FeedManager::MAX_ITEMS / 4 = 200. This takes that cap rather than copying the
// owner's whole history — already on their profile and in Home — into every
// list they join. Other members backfill more (LIST_MEMBER_BACKFILL_MAX_POSTS).
export const LIST_OWNER_BACKFILL_MAX_POSTS = 200

// Any other member backfills at most this many of their most recent stored
// posts, read in LIST_MEMBER_BACKFILL_BATCH_SIZE pages. The backfill runs inside
// the request (and, on a remote Follow Accept, the inbox transaction), so
// neither its memory nor its write volume may scale with how much history is
// cached for the member. Mastodon ≥ 4.4 merges 200; this stays generous.
export const LIST_MEMBER_BACKFILL_MAX_POSTS = 1000
export const LIST_MEMBER_BACKFILL_BATCH_SIZE = 250

export interface TimelineRuleParams {
  database: Database
  currentActor: Actor
  status: Status
}

export type MainTimelineRule = (
  params: TimelineRuleParams
) => Promise<Timeline.MAIN | null>
