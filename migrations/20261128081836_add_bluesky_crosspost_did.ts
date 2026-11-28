import type { Kysely } from 'kysely'

// Pins each Bluesky cross-post to the account it was queued for:
// - `bluesky_crossposts.did`: the DID of the Bluesky account the row was
//   claimed for. The cross-post job posts only while the actor's linked
//   account still has this DID, so a row queued for one account is never
//   published to, retried on, or cleaned up through another the actor links
//   later. NULL marks a row written before this column existed.
// - `bluesky_crossposts_did_state_idx`: the (did, state) lookups.
//
// Backfill: a posted row's uri names its own DID; a row with no record yet
// takes the DID of the actor's current linked account, when there is one.

// A strict at://<did>/<collection>/<rkey> with a did:plc or did:web authority.
const AT_URI_DID_PATTERN =
  /^at:\/\/(did:(?:plc|web):[A-Za-z0-9._:%-]+)\/[^/]+\/[^/]+$/

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const columns =
    (await db.introspection.getTables()).find(
      (table) => table.name === 'bluesky_crossposts'
    )?.columns ?? []
  if (!columns.some((column) => column.name === 'did')) {
    await db.schema
      .alterTable('bluesky_crossposts')
      .addColumn('did', 'varchar(255)')
      .execute()
  }

  await db.schema
    .createIndex('bluesky_crossposts_did_state_idx')
    .ifNotExists()
    .on('bluesky_crossposts')
    .columns(['did', 'state'])
    .execute()

  const rows = await db
    .selectFrom('bluesky_crossposts')
    .select(['statusId', 'uri'])
    .where('did', 'is', null)
    .execute()
  for (const row of rows) {
    const did = row.uri?.match(AT_URI_DID_PATTERN)?.[1]
    if (!did) continue
    await db
      .updateTable('bluesky_crossposts')
      .set({ did })
      .where('statusId', '=', row.statusId)
      .execute()
  }

  // A row that never recorded a record has no DID of its own: the account the
  // actor has linked now is the only one it could have been queued for.
  const unrecorded = await db
    .selectFrom('bluesky_crossposts')
    .select(['statusId', 'actorId'])
    .where('did', 'is', null)
    .where('uri', 'is', null)
    .execute()
  for (const row of unrecorded) {
    const account = await db
      .selectFrom('bluesky_accounts')
      .select('did')
      .where('actorId', '=', row.actorId)
      .executeTakeFirst()
    if (!account) continue
    await db
      .updateTable('bluesky_crossposts')
      .set({ did: account.did })
      .where('statusId', '=', row.statusId)
      .execute()
  }
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema
    .dropIndex('bluesky_crossposts_did_state_idx')
    .ifExists()
    .execute()

  const columns =
    (await db.introspection.getTables()).find(
      (table) => table.name === 'bluesky_crossposts'
    )?.columns ?? []
  if (columns.some((column) => column.name === 'did')) {
    await db.schema.alterTable('bluesky_crossposts').dropColumn('did').execute()
  }
}
