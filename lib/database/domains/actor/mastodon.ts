// Actors as Mastodon Account entities, and the profile directory.
import { sql } from 'kysely'

import { getActorCountersByActorId } from '@/lib/database/domains/actor/counters'
import {
  EMPTY_ACTOR_COUNTERS,
  asSQLActor,
  getMastodonAccountFromSQLActor
} from '@/lib/database/domains/actor/rows'
import type {
  GetActorFromIdParams,
  GetActorsFromIdsParams,
  GetLocalActorsParams
} from '@/lib/database/domains/actor/types'
import type { Db } from '@/lib/database/kysely'
import type { Mastodon } from '@/lib/types/activitypub'

// One Account per requested id that has an actor row, in request order. A
// repeated id yields its Account again.
export const getMastodonActors = async (
  db: Db,
  actorIds: string[]
): Promise<Mastodon.Account[]> => {
  const uniqueActorIds = [...new Set(actorIds)]
  if (uniqueActorIds.length === 0) return []

  const rows = await db
    .selectFrom('actors')
    .selectAll()
    .$narrowType<{ id: string }>()
    .where('id', 'in', uniqueActorIds)
    .execute()
  if (rows.length === 0) return []

  const sqlActorById = new Map(rows.map((row) => [row.id, asSQLActor(row)]))
  const countersByActorId = await getActorCountersByActorId(
    db,
    rows.map((row) => row.id)
  )

  return actorIds.flatMap((id) => {
    const sqlActor = sqlActorById.get(id)
    if (!sqlActor) return []
    return getMastodonAccountFromSQLActor(
      sqlActor,
      countersByActorId.get(id) ?? EMPTY_ACTOR_COUNTERS
    )
  })
}

export const getMastodonActor = async (
  db: Db,
  actorId: string
): Promise<Mastodon.Account | null> =>
  (await getMastodonActors(db, [actorId]))[0] ?? null

export const getMastodonActorFromId = (db: Db, { id }: GetActorFromIdParams) =>
  getMastodonActor(db, id)

export const getMastodonActorsFromIds = (
  db: Db,
  { ids }: GetActorsFromIdsParams
) => getMastodonActors(db, ids)

export const getLocalMastodonActors = async (
  db: Db,
  {
    localDomain,
    limit = 40,
    offset = 0,
    order = 'active',
    local = true
  }: GetLocalActorsParams
): Promise<Mastodon.Account[]> => {
  // Actors store the bare host in `domain`, but callers may pass a configured
  // host that includes a scheme (e.g. `https://example.com`). Normalize so the
  // comparison matches.
  const normalizedDomain = localDomain.includes('://')
    ? new URL(localDomain).host
    : localDomain

  const rows = await db
    .selectFrom('actors')
    .select('actors.id')
    .$narrowType<{ id: string }>()
    // The directory never lists suspended or silenced actors on any surface.
    .where('actors.suspendedAt', 'is', null)
    .where('actors.silencedAt', 'is', null)
    // local=false lists every known profile (Mastodon's default directory);
    // local=true keeps only this server's account-backed actors.
    .$if(local, (qb) =>
      qb
        .where('actors.domain', '=', normalizedDomain)
        .where('actors.accountId', 'is not', null)
    )
    // Even the all-profiles view must not expose internal system actors —
    // the headless federation signer and any other local actor with no
    // backing account (accountId null on the local domain). Remote actors
    // (foreign domain) and local account-backed actors are still listed.
    .$if(!local, (qb) =>
      qb.where((eb) =>
        eb.not(
          eb.and([
            eb('actors.domain', '=', normalizedDomain),
            eb('actors.accountId', 'is', null)
          ])
        )
      )
    )
    // `active` sorts by the persisted `actors.lastStatusAt` (maintained inside
    // the status create/delete transactions). Actors who have never posted
    // (NULL) sort last on both SQLite and PostgreSQL: `is null` yields false
    // (0) before true (1), the portable NULLS LAST pattern; the newest account
    // breaks ties.
    .$if(order === 'active', (qb) =>
      qb
        .orderBy(sql`${sql.ref('actors.lastStatusAt')} is null`)
        .orderBy('actors.lastStatusAt', 'desc')
    )
    .orderBy('actors.createdAt', 'desc')
    .limit(limit)
    .offset(offset)
    .execute()

  return getMastodonActors(
    db,
    rows.map((row) => row.id)
  )
}
