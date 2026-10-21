import type { Kysely } from 'kysely'

// Gives rules, announcements and reports a domain dimension, and lets a domain
// turn features off (step 5 of the multi-domain plan):
//
// - `instance_rules.domain` and `announcements.domain`: the served domain a
//   rule or announcement belongs to. Null (every existing row) means every
//   domain, which is what they were before.
// - `reports.domain`: the domain of the reported profile, set when the report
//   is filed. Backfilled below from the target actor's id (an actor id is a
//   URL on the domain the actor lives on). Null when it cannot be told.
// - `domains.disabledFeatures`: a JSON list of the features ('fitness',
//   'explore', 'messages') this domain turns off. Null means none.
//
// One alterTable per column: SQLite takes a single ADD COLUMN per ALTER
// TABLE. Each column is skipped when it already exists, so `up` is safe to
// run twice.

const COLUMNS = [
  ['instance_rules', 'domain', 'varchar(255)'],
  ['announcements', 'domain', 'varchar(255)'],
  ['reports', 'domain', 'varchar(255)'],
  ['domains', 'disabledFeatures', 'text']
] as const

// The served authority of an actor id: the lower-cased host, with a port only
// when it is not the default one (the same form `domains.domain` stores).
const hostOfActorId = (actorId: string): string | null => {
  try {
    const url = new URL(actorId)
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!hostname) return null
    const port = url.port === '443' || url.port === '80' ? '' : url.port
    return port ? `${hostname}:${port}` : hostname
  } catch {
    return null
  }
}

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const tables = await db.introspection.getTables()
  for (const [table, name, type] of COLUMNS) {
    const existing = new Set(
      tables
        .find((candidate) => candidate.name === table)
        ?.columns.map((column) => column.name) ?? []
    )
    if (existing.has(name)) continue
    await db.schema.alterTable(table).addColumn(name, type).execute()
  }

  // Backfill reports.domain, one update per distinct reported actor.
  const targets = await db
    .selectFrom('reports')
    .select('targetActorId')
    .distinct()
    .where('domain', 'is', null)
    .execute()
  for (const { targetActorId } of targets) {
    const domain = hostOfActorId(targetActorId)
    if (!domain) continue
    await db
      .updateTable('reports')
      .set({ domain })
      .where('targetActorId', '=', targetActorId)
      .where('domain', 'is', null)
      .execute()
  }
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  for (const [table, name] of [...COLUMNS].reverse()) {
    await db.schema.alterTable(table).dropColumn(name).execute()
  }
}
