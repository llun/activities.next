import type { Kysely } from 'kysely'

// Adds the per-domain "Who can host a Bluesky account" setting to `domains`,
// so an admin can open embedded-PDS hosting on a served domain without editing
// ACTIVITIES_BLUESKY_PDS:
// - `blueskyHostingPolicy`: 'nobody', 'listed' or 'everyone'. NULL means the
//   domain has no setting of its own and the environment's allowEmails /
//   allowActors decide (the behaviour before this column existed).
// - `blueskyHostingAllowEmails`: JSON string[] of email addresses, used by
//   'listed'. NULL means not set.
// - `blueskyHostingAllowActors`: JSON string[] of `username@domain` profiles,
//   used by 'listed'. NULL means not set.
//
// The PDS hostname, relays and whether the domain's PDS is on stay in
// ACTIVITIES_BLUESKY_PDS: this setting only decides who may host.

const COLUMNS = [
  { name: 'blueskyHostingPolicy', type: 'varchar(16)' },
  { name: 'blueskyHostingAllowEmails', type: 'text' },
  { name: 'blueskyHostingAllowActors', type: 'text' }
] as const

// oxlint-disable-next-line typescript/no-explicit-any
const domainColumns = async (db: Kysely<any>) =>
  (await db.introspection.getTables()).find((table) => table.name === 'domains')
    ?.columns ?? []

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const columns = await domainColumns(db)
  for (const column of COLUMNS) {
    if (columns.some((existing) => existing.name === column.name)) continue
    await db.schema
      .alterTable('domains')
      .addColumn(column.name, column.type)
      .execute()
  }
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  const columns = await domainColumns(db)
  for (const column of [...COLUMNS].reverse()) {
    if (!columns.some((existing) => existing.name === column.name)) continue
    await db.schema.alterTable('domains').dropColumn(column.name).execute()
  }
}
