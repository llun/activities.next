// better-auth 1.7 added three columns to tables it owns.
//
// `account_providers.issuer` is the load-bearing one: `signInEmail` now matches
// the credential row on `issuer` as well as `providerId`, so a row without one
// is invisible to sign-in and every existing account would be locked out. The
// values mirror better-auth's own `createLocalAccountIssuer` /
// `createOAuthAccountIssuer` (`@better-auth/core/db`) — deliberately re-derived
// here rather than imported, so this migration keeps replaying the same way
// after better-auth is upgraded again or removed.
//
// `jwks.alg` and `jwks.crv` let the JWT plugin record which algorithm a key was
// minted for. Both are optional in better-auth's schema, but `alg` is written
// on every key it creates, so without the column key creation fails outright
// and /api/auth/jwks 500s.

const LOCAL_CREDENTIAL_PROVIDER = 'credential'

// `local:` is better-auth's namespace for authentication methods this server
// owns; `local:oauth:` is the one for external identities that carry no issuer
// of their own. Only `credential` rows are ever written locally (the one
// historical external provider, github, was purged in
// 20260518000000_remove_github_auth_provider_links), but any row left behind
// still needs an issuer, so both namespaces are covered.
const issuerForProvider = (provider) =>
  provider === LOCAL_CREDENTIAL_PROVIDER
    ? `local:${encodeURIComponent(provider)}`
    : `local:oauth:${encodeURIComponent(provider)}`

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.transaction(async (trx) => {
    await trx.schema.alterTable('account_providers', (table) => {
      table.string('issuer').nullable()
    })

    // Backfill per distinct provider rather than one blanket UPDATE: the value
    // depends on the provider name, and `encodeURIComponent` has no portable
    // SQL equivalent.
    const providers = await trx('account_providers')
      .distinct('provider')
      .whereNotNull('provider')
    for (const { provider } of providers) {
      await trx('account_providers')
        .where('provider', provider)
        .update({ issuer: issuerForProvider(provider) })
    }

    await trx.schema.alterTable('jwks', (table) => {
      table.string('alg').nullable()
      table.string('crv').nullable()
    })
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.transaction(async (trx) => {
    await trx.schema.alterTable('jwks', (table) => {
      table.dropColumn('alg')
      table.dropColumn('crv')
    })
    await trx.schema.alterTable('account_providers', (table) => {
      table.dropColumn('issuer')
    })
  })
}
