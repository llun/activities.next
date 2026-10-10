// Parameter and result types of the scheduled status domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import type * as Mastodon from '@/lib/types/mastodon'

// A status an actor has scheduled for future publication. `params` is the
// Mastodon "params" payload (text, visibility, media_ids, poll, …) stored as
// JSON text; `scheduledAt`/`createdAt`/`updatedAt` are epoch milliseconds in
// the domain shape regardless of the backend's timestamp storage.
export type ScheduledStatusData = {
  id: string
  actorId: string
  scheduledAt: number
  params: Mastodon.ScheduledStatusParams
  createdAt: number
  updatedAt: number
}

export type CreateScheduledStatusParams = {
  actorId: string
  scheduledAt: number
  params: Mastodon.ScheduledStatusParams
}
export type GetScheduledStatusesParams = {
  actorId: string
  limit: number
  maxId?: string
  minId?: string
  sinceId?: string
}
export type GetScheduledStatusParams = { actorId: string; id: string }
export type GetScheduledStatusByIdParams = { id: string }
export type UpdateScheduledStatusAtParams = {
  actorId: string
  id: string
  scheduledAt: number
}
export type DeleteScheduledStatusParams = { actorId: string; id: string }

export interface ScheduledStatusDatabase {
  createScheduledStatus(
    params: CreateScheduledStatusParams
  ): Promise<ScheduledStatusData>
  // Owner-scoped list ordered by scheduledAt descending (id as a stable
  // tiebreaker) for Mastodon's scheduled_statuses cursor pagination — the
  // maxId/minId/sinceId cursors keyset on scheduledAt + id.
  getScheduledStatuses(
    params: GetScheduledStatusesParams
  ): Promise<ScheduledStatusData[]>
  getScheduledStatus(
    params: GetScheduledStatusParams
  ): Promise<ScheduledStatusData | null>
  // Owner-agnostic lookup by id, for the background publish job which only
  // carries the scheduled status id.
  getScheduledStatusById(
    params: GetScheduledStatusByIdParams
  ): Promise<ScheduledStatusData | null>
  // Reschedule; returns the updated row or null when not found/owned.
  updateScheduledStatusAt(
    params: UpdateScheduledStatusAtParams
  ): Promise<ScheduledStatusData | null>
  // Owner-scoped delete; true when a row was removed.
  deleteScheduledStatus(params: DeleteScheduledStatusParams): Promise<boolean>
}
