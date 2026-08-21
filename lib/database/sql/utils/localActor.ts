import { Knex } from 'knex'

// "This server hosts this actor", as a SQL predicate.
//
// A local actor is one we hold a signing key for. The obvious spelling —
// `privateKey IS NOT NULL` — is NOT that test. Actor rows written by earlier
// remote-recording paths carry `privateKey = ''`, an empty string rather than
// NULL, and every one of them is a remote actor. On production that is 216 of
// the 221 rows a null-only check calls local, which is how the local public
// timeline came to serve a majority of remote posts.
//
// The application layer never had the bug: `getActorFromRow` omits
// `privateKey` from the domain object unless it is truthy, so an `Actor` built
// from an empty-string row carries no key and every JS-side `actor.privateKey`
// test already reads it as remote. Only the SQL predicates disagreed, and this
// modifier is how they stop.
//
// `20260821120000_normalize_empty_actor_private_key.js` rewrites the stored
// empty strings to NULL so both halves agree on existing data. The `<> ''` half
// stays regardless: it costs nothing, and it keeps the predicate correct for a
// database restored from an older dump or written by a version that predates
// the migration.
//
// Written for knex's `modify`, which keeps it chainable both on a builder and
// inside a `whereExists` callback:
//
//     database('actors').modify(whereLocalActor)
//     query.modify(whereLocalActor, 'actors.privateKey')
//
// Note that `<> ''` alone would already exclude NULL rows — `NULL <> ''` is
// unknown, not true, on every backend we support. Both halves are spelled out
// anyway so the predicate reads as its intent rather than as a trick, and so
// PostgreSQL can match it against the partial `actors_local_idx`, whose own
// predicate is the `IS NOT NULL` half.
export const whereLocalActor = (
  query: Knex.QueryBuilder,
  column: string = 'privateKey'
): void => {
  query.whereNotNull(column).where(column, '<>', '')
}
