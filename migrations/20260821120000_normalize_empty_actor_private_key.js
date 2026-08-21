// Rewrites `actors.privateKey = ''` to NULL.
//
// "This server hosts this actor" is "we hold a signing key for it". Actor rows
// written by earlier remote-recording paths stored an empty string instead of
// NULL for the key they did not have, so the natural SQL spelling of that test
// — `privateKey IS NOT NULL` — counted every one of them as local. On the
// instance this was found on that was 216 of the 221 rows the check matched,
// all of them on remote domains, which is why the local public timeline served
// a majority of remote posts and why its query planned around 221 actors
// instead of 5.
//
// This normalises every such row rather than only the accountless ones. A row
// with an account AND an empty key would be a local actor that cannot sign, and
// is already non-functional today — webfinger returns null for it and its
// requests go out unsigned — so there is no working state to preserve. Leaving
// it as '' would instead leave one row that a future hand-written
// `IS NOT NULL` would still read as local, which is the trap being closed.
// Worth confirming none exists before deploying:
//   SELECT count(*) FROM actors
//    WHERE "accountId" IS NOT NULL AND ("privateKey" IS NULL OR "privateKey" = '');
//
// The application layer never disagreed: `getActorFromRow` omits `privateKey`
// from the domain object unless it is truthy, so an `Actor` built from one of
// these rows already had no key and every JS-side test already read it as
// remote. This migration makes the stored data say the same thing.
//
// The read paths are being fixed in the same change (they now test
// `IS NOT NULL AND <> ''` through `lib/database/sql/utils/localActor.ts`), so
// this migration is not load-bearing for correctness — it is what lets the
// partial `actors_local_idx` shrink to the actors that are genuinely local, and
// what keeps a future `IS NOT NULL` written by hand from reintroducing the bug
// on existing data.
//
// A single set-based UPDATE: the column is nullable on every supported backend
// and there is no index or constraint on its value, so there is nothing to
// chunk around. Re-running is a no-op once the rows are NULL.

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  await knex('actors').where('privateKey', '').update({ privateKey: null })
}

/**
 * Irreversible by design. Rolling back would mean writing '' to rows that are
 * now NULL, and the two are indistinguishable afterwards — the empty strings
 * carried no information beyond "no key", which NULL already says. Restoring
 * them would only reinstate the bug. Implemented as a no-op so rolling back
 * later migrations does not fail on this one.
 *
 * @param { import("knex").Knex } _knex
 * @returns { Promise<void> }
 */
export const down = async function (_knex) {
  // No-op: '' and NULL both mean "no signing key"; nothing to restore.
}
