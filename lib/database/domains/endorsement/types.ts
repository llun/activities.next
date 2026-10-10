// Parameter and result types of the endorsement domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import type { Endorsement } from '@/lib/types/domain/endorsement'

export type CreateEndorsementParams = {
  actorId: string
  targetActorId: string
}
export type DeleteEndorsementParams = {
  actorId: string
  targetActorId: string
}
export type GetEndorsementParams = {
  actorId: string
  targetActorId: string
}
export type GetEndorsementsParams = {
  actorId: string
  limit: number
  maxId?: string | null
  // min_id and since_id have distinct Mastodon semantics and are ordered
  // differently: min_id returns the oldest band immediately after the cursor,
  // since_id returns the newest band above the cursor.
  minId?: string | null
  sinceId?: string | null
}

export interface EndorsementDatabase {
  // Idempotently endorse (feature) targetActorId from actorId. Returns the
  // stored endorsement.
  createEndorsement(params: CreateEndorsementParams): Promise<Endorsement>
  // Removes the endorsement if present (no-op otherwise).
  deleteEndorsement(params: DeleteEndorsementParams): Promise<void>
  // Returns the endorsement for (actorId -> targetActorId), or null.
  getEndorsement(params: GetEndorsementParams): Promise<Endorsement | null>
  // Endorsements made BY actorId, newest first, paginated by numeric id cursor.
  getEndorsements(params: GetEndorsementsParams): Promise<Endorsement[]>
}
