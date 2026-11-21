import type { Kysely } from 'kysely'

// Indexes `accounts.emailChangeCode`, which confirming an email change looks
// accounts up by, so that lookup no longer scans the whole table. Same shape as
// `passwordResetCodeIndex` on `passwordResetCode`.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  await db.schema
    .createIndex('emailChangeCodeIndex')
    .ifNotExists()
    .on('accounts')
    .column('emailChangeCode')
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.dropIndex('emailChangeCodeIndex').ifExists().execute()
}
