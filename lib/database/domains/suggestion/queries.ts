import type {
  DismissSuggestionParams,
  FriendsOfFriendsSuggestion,
  GetFriendsOfFriendsSuggestionsParams
} from '@/lib/database/domains/suggestion/types'
import type { Db } from '@/lib/database/kysely'
import { FollowStatus } from '@/lib/types/domain/follow'

export const getFriendsOfFriendsSuggestions = async (
  db: Db,
  { actorId, limit }: GetFriendsOfFriendsSuggestionsParams
): Promise<FriendsOfFriendsSuggestion[]> => {
  // f1: who actorId follows; f2: who those accounts follow. Only Accepted
  // edges count on both hops. A candidate is excluded when the actor already
  // follows it, has a pending follow request to it, has dismissed it, is in a
  // block with it (either direction), or has an active mute on it. Filtering
  // here — BEFORE LIMIT — mirrors applyBlockMuteFilter so the page is never
  // returned short (Undo/Rejected follows remain suggestable).
  const now = Date.now()
  const rows = await db
    .selectFrom('follows as f1')
    .innerJoin('follows as f2', (join) =>
      join
        .onRef('f2.actorId', '=', 'f1.targetActorId')
        .on('f2.status', '=', FollowStatus.enum.Accepted)
    )
    .where('f1.actorId', '=', actorId)
    .where('f1.status', '=', FollowStatus.enum.Accepted)
    .where('f2.targetActorId', '<>', actorId)
    .where('f2.targetActorId', 'not in', (eb) =>
      eb
        .selectFrom('follows')
        .select('targetActorId')
        .where('actorId', '=', actorId)
        .where('status', 'in', [
          FollowStatus.enum.Accepted,
          FollowStatus.enum.Requested
        ])
    )
    .where('f2.targetActorId', 'not in', (eb) =>
      eb
        .selectFrom('suggestion_dismissals')
        .select('targetActorId')
        .where('actorId', '=', actorId)
    )
    // Blocks are bidirectional: drop a candidate the actor blocks OR who
    // blocks the actor. Two separate clauses so each can use its own
    // (actorId|targetActorId) index on the blocks table.
    .where('f2.targetActorId', 'not in', (eb) =>
      eb
        .selectFrom('blocks')
        .select('targetActorId')
        .where('actorId', '=', actorId)
    )
    .where('f2.targetActorId', 'not in', (eb) =>
      eb
        .selectFrom('blocks')
        .select('actorId')
        .where('targetActorId', '=', actorId)
    )
    // Mutes are one-directional (only what the actor mutes) and expire: a
    // mute is active while endsAt IS NULL or endsAt >= now (matching
    // applyBlockMuteFilter and getMute's "expired when endsAt < now").
    .where('f2.targetActorId', 'not in', (eb) =>
      eb
        .selectFrom('mutes')
        .select('targetActorId')
        .where('actorId', '=', actorId)
        .where((mute) =>
          mute.or([mute('endsAt', 'is', null), mute('endsAt', '>=', now)])
        )
    )
    .groupBy('f2.targetActorId')
    .select('f2.targetActorId as targetActorId')
    .select((eb) => eb.fn.countAll().as('mutuals'))
    .orderBy('mutuals', 'desc')
    .orderBy('targetActorId')
    .limit(limit)
    .execute()

  return rows.map((row): FriendsOfFriendsSuggestion => ({
    // follows.targetActorId is nullable in the schema, but the join and the
    // `<>` filter above drop rows where it is NULL.
    targetActorId: row.targetActorId as string,
    // count(*) has no declared column type, so SQLite hands it back as is.
    mutuals: Number(row.mutuals)
  }))
}

export const dismissSuggestion = async (
  db: Db,
  { actorId, targetActorId }: DismissSuggestionParams
): Promise<void> => {
  // Idempotent: ignore on the (actorId, targetActorId) primary key so a
  // repeat dismissal of the same pair is a no-op instead of an error.
  await db
    .insertInto('suggestion_dismissals')
    .values({ actorId, targetActorId, createdAt: new Date() })
    .onConflict((oc) => oc.columns(['actorId', 'targetActorId']).doNothing())
    .execute()
}

export const suggestionQueries = {
  getFriendsOfFriendsSuggestions,
  dismissSuggestion
}
