// Parameter and result types of the follow suggestion domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

// A friends-of-friends follow suggestion candidate: an account followed by
// the accounts `actorId` follows. `mutuals` is the number of accepted
// follow edges from those followed accounts to the candidate, used for
// ranking (descending).
export type FriendsOfFriendsSuggestion = {
  targetActorId: string
  mutuals: number
}

export type GetFriendsOfFriendsSuggestionsParams = {
  actorId: string
  limit: number
}
export type DismissSuggestionParams = {
  actorId: string
  targetActorId: string
}

export interface SuggestionDatabase {
  // Accounts followed by the accounts `actorId` follows, ranked by mutual
  // count descending (targetActorId ascending as a stable tiebreaker).
  // Excludes `actorId` itself, anyone `actorId` already follows (Accepted) or
  // has a pending request to, anyone `actorId` has dismissed, anyone in a block
  // with `actorId` (either direction), and anyone `actorId` actively mutes.
  // Only Accepted follow edges count on both hops.
  getFriendsOfFriendsSuggestions(
    params: GetFriendsOfFriendsSuggestionsParams
  ): Promise<FriendsOfFriendsSuggestion[]>
  // Idempotent: dismissing an already-dismissed pair is a no-op.
  dismissSuggestion(params: DismissSuggestionParams): Promise<void>
}
