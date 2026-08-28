// Backfills `oauthClient.clientCredentialsScopes` for applications registered
// before the column was written.
//
// better-auth 1.6 validated a `client_credentials` request against the client's
// registered `scopes`. 1.7 moved that decision to this separate, server-owned
// column and denies the grant outright when it is missing or empty:
//
//   400 {"error":"unauthorized_client",
//        "error_description":"client has no authorized client_credentials scopes"}
//
// The column arrived with the 1.7 schema migration and nothing ever wrote it, so
// every application registered through `POST /api/v1/apps` — every Mastodon
// client on the instance — has NULL. A native client asks for an app-level token
// before it offers to sign a user in (Ivory does, with the credentials the
// registration just handed it), so that 400 stops the login before it starts.
//
// `createApplication` writes the column from here on, but a Mastodon client
// persists its client_id/client_secret indefinitely and only re-registers when
// its stored copy is missing — the same reason registrations are never garbage
// collected. Fixing the write path alone would therefore leave every client
// already installed permanently unable to log in, so the existing rows have to
// be repaired.
//
// The ceiling written is the application's own registered scopes, minus the
// scopes better-auth reserves for user-delegated grants. That restores what 1.6
// granted and matches Mastodon, where an app token carries the scopes the
// application registered with.
//
// It is deliberately STRICTER than 1.6 rather than a replay of it, and the rule
// is the useful form: the ceiling is derived only from the client's OWN recorded
// scopes, so anywhere 1.6 reached past those, this does not. 1.6 reached past
// them in two ways — it skipped its reserved-scope filter when the client
// omitted `scope`, and it fell back to the server's entire scope vocabulary for
// a client with no scopes recorded (`client.scopes ?? opts.scopes`), which for a
// scope-less legacy row meant a token carrying everything this server knows.
//
// Kept in sync with `toClientCredentialsScopes` in
// `lib/services/oauth/clientCredentialsScopes.ts`, which this file cannot import:
// migrations run through the plain `knex` CLI, with no TypeScript loader and no
// path aliases. `oauthClientCredentialsScopesMigration.test.ts` pins the two
// against each other.

const USER_DELEGATED_SCOPES = new Set([
  'openid',
  'profile',
  'email',
  'offline_access'
])

// Rows are read in bounded pages rather than all at once: registrations are
// never deleted, so this table only grows. Every row a page reads is written —
// see the `row.id == null` skip below for the one case that would not be — so
// the `IS NULL` predicate strictly shrinks and the loop terminates.
const BATCH_SIZE = 500

// `oauthClient.scopes` and `.grantTypes` hold JSON-array strings, which is what
// better-auth's adapter writes and what `createApplication` and the original
// `clients` import wrote — the app itself reads `oauthClient.scopes` with a bare
// `JSON.parse` (`getCompatibleJSON`), so nothing on the read path tolerates any
// other spelling. The array and delimiter-separated branches below are therefore
// belt-and-braces for a legacy or hand-edited row this one-shot backfill cannot
// re-examine later, not a shape the schema is known to hold. Reading
// `'read write'` as one opaque scope would not deny the grant — the ceiling
// would be non-empty, so better-auth accepts it and then rejects the client's
// real request with `invalid_scope`, which is harder to diagnose than a denial.
const parseStoredList = (raw) => {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw !== 'string') return []
  const trimmed = raw.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      // Fall through to delimiter splitting.
    }
  }
  return trimmed.split(/[\s,]+/).filter(Boolean)
}

// The ceiling for one client. Empty is a meaningful, correct value — better-auth
// reads it as "this client may not use the client_credentials grant" — and it is
// what a client that cannot use the grant must be given, so that the row stops
// matching the `IS NULL` predicate and the loop makes progress.
const resolveClientCredentialsScopes = (row) => {
  // A public client is refused the grant by better-auth regardless, and
  // assigning one a ceiling is a combination it rejects as invalid metadata.
  if (row.tokenEndpointAuthMethod === 'none') return []
  if (!parseStoredList(row.grantTypes).includes('client_credentials')) return []
  return [
    ...new Set(
      parseStoredList(row.scopes).filter(
        (scope) => !USER_DELEGATED_SCOPES.has(scope)
      )
    )
  ]
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function (knex) {
  for (;;) {
    const rows = await knex('oauthClient')
      .whereNull('clientCredentialsScopes')
      .select('id', 'scopes', 'grantTypes', 'tokenEndpointAuthMethod')
      .orderBy('id')
      .limit(BATCH_SIZE)
    if (rows.length === 0) return

    // Most clients on an instance register with the same handful of scopes, so
    // group the page by the value each row resolves to and write one statement
    // per distinct value instead of one per row.
    const idsByValue = new Map()
    for (const row of rows) {
      // `whereIn('id', [null])` matches nothing, so a row with no id would be
      // re-read on every pass and the loop would never end. Nothing writes such
      // a row — `id` is NOT NULL on PostgreSQL, and every insert generates one —
      // but SQLite permits NULL in a non-INTEGER primary key, and a migration
      // that spins holds the knex migration lock for as long as it runs. Skip it
      // so the rest of the page still makes progress.
      if (row.id == null) continue
      const value = JSON.stringify(resolveClientCredentialsScopes(row))
      const ids = idsByValue.get(value)
      if (ids) ids.push(row.id)
      else idsByValue.set(value, [row.id])
    }

    // Every row on this page was skipped, so no later page can make progress
    // either — the predicate would return the same rows forever.
    if (idsByValue.size === 0) return

    for (const [value, ids] of idsByValue) {
      await knex('oauthClient')
        .whereIn('id', ids)
        .update({ clientCredentialsScopes: value })
    }
  }
}

/**
 * Irreversible by design. Restoring NULL would reinstate the bug this repairs,
 * and the column carries no information that predates this migration — the rows
 * it fills held NULL because nothing had ever written them. Rolling the code
 * back to better-auth 1.6 makes the column unread rather than wrong, so there is
 * nothing a rollback needs to undo. Implemented as a no-op so rolling back later
 * migrations does not fail on this one.
 *
 * @param { import("knex").Knex } _knex
 * @returns { Promise<void> }
 */
export const down = async function (_knex) {
  // No-op: see above.
}
