// Parameter and result types of the status reaction domain (Misskey/Pleroma
// emoji reactions).
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

// One reaction row per (status, actor, name) — Pleroma/glitch-soc multi-reaction
// semantics rather than Misskey's one-per-actor rule, so a legitimate inbound
// second reaction is never silently dropped or destructively replaced.
//
// `name` is stored colon-free: a unicode emoji, a local custom-emoji shortcode,
// or `shortcode@domain` for a remote custom emoji. `url` carries the remote
// emoji image; local shortcodes resolve live from `customEmojis` so an admin
// re-upload propagates.
//
// A reaction is NEVER a favourite: it writes no `likes` row and never moves
// `favourites_count`/`favourited`.
interface BaseStatusReactionParams {
  statusId: string
  actorId: string
  name: string
}

export type CreateStatusReactionParams = BaseStatusReactionParams & {
  url?: string | null
}
export type DeleteStatusReactionParams = BaseStatusReactionParams

export type GetStatusReactionRollupsParams = {
  statusIds: string[]
  currentActorId?: string
}

// One (status, name) reaction rollup: `count` is the number of distinct actors
// who reacted with `name`, `me` whether the querying actor is among them, and
// `url`/`staticUrl` the emoji image for custom emoji (null for unicode).
export type StatusReactionRollup = {
  statusId: string
  name: string
  count: number
  me: boolean
  url: string | null
  staticUrl: string | null
}

export type GetStatusReactionActorsParams = {
  statusId: string
  // Restrict to a single reaction name. Omit for every reaction on the status.
  name?: string
}

export type StatusReactionActor = {
  name: string
  actorId: string
  createdAt: number
}

export interface StatusReactionDatabase {
  // Idempotent on (statusId, actorId, name). Returns whether a row was actually
  // stored: false when the status does not exist, the actor had already reacted
  // with this name, or the actor is at the per-status reaction cap. Callers use
  // it to fire notifications (and, from PR 5.1b, federation) only on a real
  // state change.
  createStatusReaction(params: CreateStatusReactionParams): Promise<boolean>
  // Returns whether a row was removed, so callers can skip the outbound Undo
  // (PR 5.1b) when the reaction was not there to begin with.
  deleteStatusReaction(params: DeleteStatusReactionParams): Promise<boolean>
  // Rollups grouped by (statusId, name) for the given statuses, ordered by
  // first-reaction time ascending (Pleroma's insertion order).
  getStatusReactionRollups(
    params: GetStatusReactionRollupsParams
  ): Promise<StatusReactionRollup[]>
  // The actors behind a status's reactions, oldest first.
  getStatusReactionActors(
    params: GetStatusReactionActorsParams
  ): Promise<StatusReactionActor[]>
}
