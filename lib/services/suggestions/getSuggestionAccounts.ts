import { Database } from '@/lib/database/types'
import { Account } from '@/lib/types/mastodon/account'

export const SUGGESTIONS_DEFAULT_LIMIT = 40
export const SUGGESTIONS_MAX_LIMIT = 80

// Mastodon clamps out-of-range or non-numeric limits to the allowed range
// instead of rejecting them (same behavior as `normalizeTimelineLimit`):
// a positive integer is capped at the max, anything else falls back to the
// default.
export const normalizeSuggestionsLimit = (rawLimit: string | null): number => {
  const limit = rawLimit !== null ? Number(rawLimit) : null
  return Number.isSafeInteger(limit) && limit && limit > 0
    ? Math.min(limit, SUGGESTIONS_MAX_LIMIT)
    : SUGGESTIONS_DEFAULT_LIMIT
}

interface GetSuggestionAccountsParams {
  database: Database
  actorId: string
  limit: number
}

/**
 * Resolve the ranked friends-of-friends follow suggestions for `actorId` into
 * Mastodon accounts. Block (either direction) and mute filtering is applied in
 * SQL by `getFriendsOfFriendsSuggestions`, so the candidate list already
 * excludes hidden accounts; this layer only hydrates the accounts and preserves
 * the candidate ranking.
 */
export const getSuggestionAccounts = async ({
  database,
  actorId,
  limit
}: GetSuggestionAccountsParams): Promise<Account[]> => {
  const candidates = await database.getFriendsOfFriendsSuggestions({
    actorId,
    limit
  })
  if (candidates.length === 0) return []

  const candidateIds = candidates.map((candidate) => candidate.targetActorId)
  const accounts = await database.getMastodonActorsFromIds({
    ids: candidateIds
  })
  // Re-order by the ranked candidate list (the serializer's output order is
  // not guaranteed) and drop candidates it could not resolve.
  const accountsByUrl = new Map(
    accounts.map((account) => [account.url, account])
  )
  return candidateIds.flatMap((id) => accountsByUrl.get(id) ?? [])
}
