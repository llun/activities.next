import type { ExpressionBuilder } from 'kysely'

import type { DB } from '@/lib/database/kysely'

// "This server hosts this actor", as a SQL predicate: it holds the actor's
// signing key. `privateKey IS NOT NULL` alone is NOT that test. Actor rows
// written by earlier remote-recording paths carry `privateKey = ''`, and every
// one of them is a remote actor: on production that was 216 of the 221 rows a
// null-only check called local, which is how the local public timeline came to
// serve a majority of remote posts. The application layer never had the bug
// (`getActorFromRow` drops a falsy `privateKey`, so such an `Actor` reads as
// remote); only the SQL predicates disagreed.
//
// `20260821120000_normalize_empty_actor_private_key.js` rewrites the stored
// empty strings to NULL. The `<> ''` half stays regardless, for a database
// restored from an older dump. `<> ''` alone would already exclude NULL
// (`NULL <> ''` is unknown, not true); both halves are spelled out so the
// predicate reads as its intent, and so PostgreSQL can match it against the
// partial `actors_local_idx`, whose own predicate is the `IS NOT NULL` half.
export const isLocalActor = (eb: ExpressionBuilder<DB, 'actors'>) =>
  eb.and([
    eb('actors.privateKey', 'is not', null),
    eb('actors.privateKey', '<>', '')
  ])
