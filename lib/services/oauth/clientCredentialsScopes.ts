// The scope ceiling this server assigns a registered application for the
// `client_credentials` grant — the app-level token a Mastodon client asks for
// before any user is involved.
//
// better-auth 1.6 validated that grant's requested scopes against the client's
// registered `scopes`. 1.7 moved the decision to a separate, server-owned
// `oauthClient.clientCredentialsScopes` column and denies the grant outright
// when it is missing or empty, so the value has to be written at registration
// time or every app token request answers `unauthorized_client`.
//
// The ceiling keeps the client's own recorded scopes and nothing from server
// configuration, minus the reserved scopes below. That matches Mastodon, where
// an app token carries the scopes the application registered with, and it is
// narrower than 1.6 on both counts — see the note on the reserved scopes, and
// 1.6's `client.scopes ?? opts.scopes`, which handed a client with no scopes
// recorded this server's entire vocabulary.

// Scopes better-auth reserves for grants that delegate a user. An app token has
// no user, so a token carrying one would name a subject that does not exist.
//
// This filter is the ONLY thing enforcing that on this write path — do not
// delete it as redundant with better-auth's own checks, because neither of them
// runs here. The plugin's assign-time validator (`validateClientCredentialsScopes`)
// lives inside its own registration and update endpoints, which `createApplication`
// bypasses with a direct knex insert; and its token-endpoint filter runs only
// when the client sends an explicit `scope` parameter — with `scope` omitted the
// stored ceiling is granted verbatim (`requestedScopes = [...clientCredentialsScopes]`).
// So a stored `openid` would be handed straight back on a token. 1.6 is no
// precedent for skipping it either: its own rejection sat inside that same
// conditional. Nor is keeping only the client's own scopes sufficient on its
// own, since a registered `openid` is one of them — `clientCredentialsScopes.test.ts`
// pins that as `denies the grant for an OpenID-only client`.
//
// `offline_access` is not part of this server's scope vocabulary; it is listed
// because better-auth reserves it, so adding it to `Scope` later cannot quietly
// reintroduce the problem.
//
// Kept in sync with the identical list in
// `migrations/20260828000000_backfill_oauth_client_credentials_scopes.js`, which
// cannot import this module: migrations run through the plain `knex` CLI with no
// TypeScript loader and no path aliases. The test that pins the two against each
// other is `lib/database/sql/oauthClientCredentialsScopesMigration.test.ts`
// ("agrees with the helper the registration path uses") — this module's own test
// exercises only this copy and would stay green while the migration's drifted.
const USER_DELEGATED_SCOPES = new Set([
  'openid',
  'profile',
  'email',
  'offline_access'
])

/**
 * Reduces an application's registered scopes to the ceiling stored in
 * `oauthClient.clientCredentialsScopes`. Deduplicates like better-auth's own
 * `normalizeClientCredentialsScopes`, so a registration asking for `read read`
 * stores one entry rather than two.
 *
 * An empty result is the correct, meaningful outcome for a client that
 * registered only user-delegated scopes: better-auth reads it as "this client
 * may not use the client_credentials grant".
 */
export const toClientCredentialsScopes = (
  scopes: readonly string[]
): string[] => [
  ...new Set(scopes.filter((scope) => !USER_DELEGATED_SCOPES.has(scope)))
]
