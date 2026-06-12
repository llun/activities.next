import { Database } from '@/lib/database/types'
import { Account } from '@/lib/types/mastodon/account'

export const SUGGESTIONS_DEFAULT_LIMIT = 40
export const SUGGESTIONS_MAX_LIMIT = 80
// Over-fetch candidates beyond the requested page so block/mute filtering and
// unresolvable actors don't leave the page short.
const CANDIDATE_FETCH_CAP = 160

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
 * Mastodon accounts, dropping any candidate involved in a block with the
 * current actor (in either direction) or muted by the current actor. The
 * returned accounts preserve the candidate ranking.
 */
export const getSuggestionAccounts = async ({
  database,
  actorId,
  limit
}: GetSuggestionAccountsParams): Promise<Account[]> => {
  const candidates = await database.getFriendsOfFriendsSuggestions({
    actorId,
    limit: Math.min(limit * 2, CANDIDATE_FETCH_CAP)
  })
  if (candidates.length === 0) return []

  const candidateIds = candidates.map((candidate) => candidate.targetActorId)
  const [blockRelations, muteRelations] = await Promise.all([
    // getBlockRelations matches blocks in both directions, so one call covers
    // both "the actor blocks the candidate" and "the candidate blocks the
    // actor".
    database.getBlockRelations({
      actorIds: [actorId],
      targetActorIds: candidateIds
    }),
    // Mutes are one-directional: only the current actor muting a candidate
    // hides the suggestion.
    database.getMuteRelations({
      actorIds: [actorId],
      targetActorIds: candidateIds
    })
  ])

  const excludedActorIds = new Set<string>()
  for (const relation of blockRelations) {
    excludedActorIds.add(
      relation.actorId === actorId ? relation.targetActorId : relation.actorId
    )
  }
  for (const relation of muteRelations) {
    if (relation.actorId === actorId) {
      excludedActorIds.add(relation.targetActorId)
    }
  }

  const visibleIds = candidateIds.filter((id) => !excludedActorIds.has(id))
  if (visibleIds.length === 0) return []

  const accounts = await database.getMastodonActorsFromIds({
    ids: visibleIds
  })
  // Re-order by the ranked candidate list (the serializer's output order is
  // not guaranteed) and drop candidates it could not resolve.
  const accountsByUrl = new Map(
    accounts.map((account) => [account.url, account])
  )
  return visibleIds.flatMap((id) => accountsByUrl.get(id) ?? []).slice(0, limit)
}
