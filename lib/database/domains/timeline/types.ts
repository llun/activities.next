// Parameter types of the timeline domain (the home, direct, local public and
// federated feeds). lib/types/database/operations.ts re-exports them, so
// existing imports keep working.
import type { Timeline } from '@/lib/services/timelines/types'
import type { Status } from '@/lib/types/domain/status'

export type GetTimelineParams = {
  timeline: Timeline
  actorId?: string
  minStatusId?: string | null
  sinceStatusId?: string | null
  maxStatusId?: string | null
  limit?: number
  // Attachments-only filter (Mastodon `only_media`). Honored by the
  // LOCAL_PUBLIC and FEDERATED_PUBLIC timelines; other timelines ignore it.
  onlyMedia?: boolean
}
export type CreateTimelineStatusParams = {
  timeline: Timeline
  actorId: string
  status: Status
}
export type AddStatusToFederatedTimelineParams = {
  statusId: string
  statusActorId: string
}

export interface TimelineDatabase {
  getTimeline({
    timeline,
    actorId,
    minStatusId,
    maxStatusId,
    limit
  }: GetTimelineParams): Promise<Status[]>
  createTimelineStatus(params: CreateTimelineStatusParams): Promise<void>
  /**
   * Appends a remote, relay-ingested status to the materialized
   * `federated_timeline` (the Federated / "whole known network" feed). Idempotent
   * — a status already present is left untouched. The timeline read for
   * `Timeline.FEDERATED_PUBLIC` joins these rows back to `statuses`.
   */
  addStatusToFederatedTimeline(
    params: AddStatusToFederatedTimelineParams
  ): Promise<void>
  /**
   * Number of statuses visible on the local public timeline (the same set
   * `getTimeline({ timeline: LOCAL_PUBLIC })` pages over). Used to decide
   * whether the logged-out landing previews the public feed or shows the brand
   * hero. Pass `limit` to stop counting once that many are found (a bounded,
   * cheaper check when the caller only needs a threshold, not the exact total).
   */
  getLocalPublicStatusesCount(limit?: number): Promise<number>
}
