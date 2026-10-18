import type { Kysely } from 'kysely'

// Adds `accounts.signUpDomain`: the domain an account signed up on, the
// normalised domain of the first actor `createAccount` writes with it. The
// sign-in allowed-emails gate exempts members of that domain from a closed,
// empty list, so it must not be inferred from the account's oldest remaining
// actor, which a member can change by deleting their first one. Null on every
// account created before this column, which all signed up on the primary
// (ACTIVITIES_HOST): readers treat null as the primary.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const tables = await db.introspection.getTables()
  const accounts = tables.find((table) => table.name === 'accounts')
  if (accounts?.columns.some((column) => column.name === 'signUpDomain')) {
    return
  }
  await db.schema
    .alterTable('accounts')
    .addColumn('signUpDomain', 'varchar(255)')
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.alterTable('accounts').dropColumn('signUpDomain').execute()
}
