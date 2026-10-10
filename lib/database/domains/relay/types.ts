// Parameter and result types of the relay domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import type { Relay, RelayState } from '@/lib/types/domain/relay'

// A subscription to an ActivityPub relay. See lib/types/domain/relay.ts for
// the field semantics. `createdAt`/`updatedAt` are epoch milliseconds in the
// domain shape regardless of the backend's timestamp storage.
export type RelayData = Relay

export type CreateRelayParams = { inboxUrl: string }
export type UpdateRelayParams = {
  id: string
  state?: RelayState
  actorId?: string | null
  followActivityId?: string | null
  lastError?: string | null
}
export type DeleteRelayParams = { id: string }
export type GetRelayByIdParams = { id: string }
export type GetRelayByActorIdParams = { actorId: string }
export type GetRelayByFollowActivityIdParams = { followActivityId: string }

export interface RelayDatabase {
  // Creates a relay row in the `idle` state. Throws on a duplicate inboxUrl.
  createRelay(params: CreateRelayParams): Promise<RelayData>
  // Partial update; bumps updatedAt and returns the updated row, or null when
  // the relay does not exist. Passing actorId/followActivityId/lastError as
  // null clears the column.
  updateRelay(params: UpdateRelayParams): Promise<RelayData | null>
  // True when a row was removed.
  deleteRelay(params: DeleteRelayParams): Promise<boolean>
  // All relays ordered by createdAt ascending.
  getRelays(): Promise<RelayData[]>
  getRelayById(params: GetRelayByIdParams): Promise<RelayData | null>
  // Resolve a relay by its actor id (used to recognise an inbound
  // relay-forwarded activity's HTTP signer). Returns null when unknown.
  getRelayByActorId(params: GetRelayByActorIdParams): Promise<RelayData | null>
  // Resolve a relay by the Follow id we sent (used to match the relay's
  // Accept/Reject back to the subscription). Returns null when unknown.
  getRelayByFollowActivityId(
    params: GetRelayByFollowActivityIdParams
  ): Promise<RelayData | null>
  // Accepted relays only — the fan-out targets for local public posts.
  getAcceptedRelays(): Promise<RelayData[]>
}
