import { type Kysely, SqliteAdapter } from 'kysely'

// Adds a domain's own identity and policies to `domains` (step 4 of the
// multi-domain plan): what visitors to that domain see as this server's
// description, contact email, terms of service and privacy policy. Every
// column is nullable and null means "Same as server": the field falls back to
// Admin › Instance (lib/services/domains/domainIdentity.ts). `name` already
// exists. The `*UpdatedAt` columns are when that policy's text last changed,
// shown as "Last updated" and as the Mastodon terms' effective date.
//
// One alterTable per column: SQLite takes a single ADD COLUMN per ALTER
// TABLE. Each column is skipped when it already exists, so `up` is safe to
// run twice.

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'
  const columns = [
    ['description', 'text'],
    ['contactEmail', 'varchar(255)'],
    ['termsOfService', 'text'],
    ['termsOfServiceUpdatedAt', timestampType],
    ['privacyPolicy', 'text'],
    ['privacyPolicyUpdatedAt', timestampType]
  ] as const

  const tables = await db.introspection.getTables()
  const existing = new Set(
    tables
      .find((table) => table.name === 'domains')
      ?.columns.map((column) => column.name) ?? []
  )
  for (const [name, type] of columns) {
    if (existing.has(name)) continue
    await db.schema.alterTable('domains').addColumn(name, type).execute()
  }
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  for (const name of [
    'privacyPolicyUpdatedAt',
    'privacyPolicy',
    'termsOfServiceUpdatedAt',
    'termsOfService',
    'contactEmail',
    'description'
  ]) {
    await db.schema.alterTable('domains').dropColumn(name).execute()
  }
}
