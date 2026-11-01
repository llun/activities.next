import { createHash } from 'node:crypto'
import type { Client as PostgresClient } from 'pg'

import { getPostgresSchemaSql } from '@/lib/database/testing/schema'

// Each Vitest worker needs its own PostgreSQL database. `prepare()` resets the
// worker's database between tests, so a single shared name lets one worker
// destroy the database another worker is running tests against — which
// surfaces as `relation "..." does not exist` or rows gone missing in
// whichever file lost the race. Vitest hands files to a worker one at a time,
// so a name per worker is enough isolation; `VITEST_POOL_ID` is unique across
// the workers running concurrently. Strip it to digits: the name is
// interpolated into `CREATE`/`DROP DATABASE` and `COMMENT ON DATABASE`, which
// cannot be parameterised.
const TEST_PG_WORKER_ID = (process.env.VITEST_POOL_ID ?? '').replace(/\D/g, '')
export const TEST_PG_DATABASE = TEST_PG_WORKER_ID
  ? `test_${TEST_PG_WORKER_ID}`
  : 'test'
export const getTestPgPort = (
  rawPort: string | undefined = process.env.TEST_DATABASE_PORT
): number => {
  if (rawPort === undefined) {
    return 5432
  }
  if (!/^[1-9]\d*$/.test(rawPort)) {
    throw new Error(
      `Invalid TEST_DATABASE_PORT "${rawPort}": must be a decimal integer between 1 and 65535`
    )
  }
  const port = Number.parseInt(rawPort, 10)
  if (port > 65535) {
    throw new Error(
      `Invalid TEST_DATABASE_PORT "${rawPort}": must be a decimal integer between 1 and 65535`
    )
  }
  return port
}

export const getTestPgConnection = () => ({
  host: process.env.TEST_DATABASE_HOST,
  port: getTestPgPort(),
  user: process.env.TEST_DATABASE_USERNAME,
  password: process.env.TEST_DATABASE_PASSWORD
})

type PgConnection = ReturnType<typeof getTestPgConnection>

const connectToPg = async (connection: PgConnection, database: string) => {
  const { Client: DynamicPostgresClient } = await import('pg')
  const client = new (
    DynamicPostgresClient as unknown as typeof PostgresClient
  )({
    ...connection,
    database
  })
  await client.connect()
  return client
}

/**
 * Drops and recreates `databaseName` through the maintenance database, so the
 * schema loader starts from an empty database.
 */
export const recreatePgDatabase = async (
  connection: PgConnection,
  databaseName: string
) => {
  const client = await connectToPg(connection, 'postgres')
  await client.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`)
  await client.query(`CREATE DATABASE ${databaseName}`)
  await client.end()
}

/**
 * One md5 over the whole `public` schema — tables with their columns (name,
 * type, notnull, default), indexes, constraints, triggers, functions, enum
 * values, views and sequences. A matching hash means the schema is what
 * `schema.sql` builds. One round trip, computed on the server.
 */
const SCHEMA_FINGERPRINT_SQL = `select md5(
  (select coalesce(string_agg(t.relname || E'\\x1f' || a.attname || E'\\x1f' ||
      format_type(a.atttypid, a.atttypmod) || E'\\x1f' || a.attnotnull::text ||
      E'\\x1f' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''),
      E'\\x1e' order by t.relname, a.attnum), '')
    from pg_class t
    join pg_namespace tn on tn.oid = t.relnamespace and tn.nspname = 'public'
    join pg_attribute a on a.attrelid = t.oid and a.attnum > 0
      and not a.attisdropped
    left join pg_attrdef d on d.adrelid = t.oid and d.adnum = a.attnum
    where t.relkind in ('r', 'p'))
  || E'\\x1d' ||
  (select coalesce(string_agg(c.relname || E'\\x1f' || pg_get_indexdef(c.oid),
      E'\\x1e' order by c.relname), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'i')
  || E'\\x1d' ||
  (select coalesce(string_agg(con.conrelid::regclass::text || E'\\x1f' ||
      con.conname || E'\\x1f' || pg_get_constraintdef(con.oid),
      E'\\x1e' order by con.conname, con.oid::text), '')
    from pg_constraint con
    where con.connamespace = 'public'::regnamespace)
  || E'\\x1d' ||
  (select coalesce(string_agg(tr.tgname || E'\\x1f' || pg_get_triggerdef(tr.oid),
      E'\\x1e' order by tr.tgname, tr.oid::text), '')
    from pg_trigger tr
    join pg_class c on c.oid = tr.tgrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where not tr.tgisinternal)
  || E'\\x1d' ||
  (select coalesce(string_agg(p.proname || E'\\x1f' ||
      pg_get_function_identity_arguments(p.oid) || E'\\x1f' ||
      format_type(p.prorettype, null),
      E'\\x1e' order by p.proname, p.oid::text), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public')
  || E'\\x1d' ||
  (select coalesce(string_agg(t.typname || E'\\x1f' || e.enumlabel,
      E'\\x1e' order by t.typname, e.enumsortorder), '')
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace and n.nspname = 'public')
  || E'\\x1d' ||
  (select coalesce(string_agg(
      c.relname || E'\\x1f' || pg_get_viewdef(c.oid, true),
      E'\\x1e' order by c.relname), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm'))
  || E'\\x1d' ||
  (select coalesce(string_agg(c.relname, E'\\x1e' order by c.relname), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S')
) as fingerprint`

// The stored fingerprint must have been computed from the dump this run ships.
const COMMENT_PATTERN = /^fingerprint=([0-9a-f]{32});schema=([0-9a-f]{64})$/

const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`

const computeSchemaFingerprint = async (target: PostgresClient) => {
  const { rows } = await target.query<{ fingerprint: string }>(
    SCHEMA_FINGERPRINT_SQL
  )
  return rows[0].fingerprint
}

/**
 * Empties the `public` tables that have rows and restarts every used sequence,
 * in one round trip after a catalog lookup. `TRUNCATE` allocates fresh files
 * for every table and index it touches, so empty tables are skipped — found
 * with `SELECT 'tbl' WHERE EXISTS (SELECT 1 FROM "tbl") UNION ALL ...`. A
 * table can be empty while its sequence stands advanced (a deleted row, a
 * rolled-back insert), so identities restart from `pg_sequences.last_value`,
 * not from the truncate. Identifiers are quoted by doubling embedded quotes;
 * they come from the worker's own catalog, not from test input.
 */
const truncatePublicTables = async (target: PostgresClient) => {
  const { rows: tableRows } = await target.query<{ relname: string }>(
    `select c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')`
  )
  const tables = tableRows.map((row) => row.relname)
  let nonEmpty: string[] = []
  if (tables.length > 0) {
    const { rows } = await target.query<{ tbl: string }>(
      tables
        .map(
          (table) =>
            `select '${table.replace(/'/g, "''")}' as tbl where exists (select 1 from ${quoteIdentifier(table)})`
        )
        .join(' union all ')
    )
    nonEmpty = rows.map((row) => row.tbl)
  }
  const { rows: sequenceRows } = await target.query<{ sequencename: string }>(
    `select sequencename from pg_sequences
     where schemaname = 'public' and last_value is not null`
  )
  const sequences = sequenceRows.map((row) => row.sequencename)
  const statements = [
    ...(nonEmpty.length
      ? [`TRUNCATE TABLE ${nonEmpty.map(quoteIdentifier).join(', ')} CASCADE`]
      : []),
    ...sequences.map(
      (name) => `ALTER SEQUENCE public.${quoteIdentifier(name)} RESTART`
    )
  ]
  if (statements.length > 0) {
    await target.query(statements.join('; '))
  }
}

/**
 * The fast `prepare()`. Replaying `schema.sql` and truncating every table
 * dominate PostgreSQL test time under parallel load — sampling
 * `pg_stat_activity` showed the workers' seconds going to the dump's DDL and
 * to catalog contention, not to `DROP DATABASE` checkpoints — so keep the
 * schema and clear only the tables with rows. Connects to `databaseName`
 * (creating it if missing), terminates other backends on it as
 * `recreatePgDatabase` does, then compares a fingerprint of the live `public`
 * schema — md5 of the catalog query above, stored alongside the sha256 of
 * `schema.sql` in `COMMENT ON DATABASE` — with what the dump builds. On a
 * match (schema unchanged since the last prepare) it empties the used tables
 * and restarts the used sequences; on a mismatch (first run, `schema.sql`
 * changed, or a test altered the schema) it resets the schema, replays the
 * dump through `loadDump` and stores the fingerprint. The database name is
 * interpolated because these statements cannot be parameterised.
 */
export const preparePgDatabase = async (
  connection: PgConnection,
  databaseName: string,
  loadDump: () => Promise<void>
) => {
  const admin = await connectToPg(connection, 'postgres')
  try {
    const existing = await admin.query(
      'select 1 from pg_database where datname = $1',
      [databaseName]
    )
    if (!existing.rows.length) {
      await admin.query(`CREATE DATABASE ${databaseName}`)
    } else {
      // What `DROP DATABASE ... WITH (FORCE)` guaranteed: a pool left over
      // from an earlier run cannot keep holding locks or connections on it.
      await admin.query(
        `select pg_terminate_backend(pid) from pg_stat_activity
       where datname = $1 and pid <> pg_backend_pid()`,
        [databaseName]
      )
    }
  } finally {
    await admin.end()
  }

  const target = await connectToPg(connection, databaseName)
  try {
    const schemaSha = createHash('sha256')
      .update(getPostgresSchemaSql())
      .digest('hex')
    const { rows } = await target.query<{ description: string | null }>(
      `select shobj_description(oid, 'pg_database') as description
       from pg_database where datname = $1`,
      [databaseName]
    )
    const stored = rows[0].description
    const storedMatch =
      stored === null ? undefined : COMMENT_PATTERN.exec(stored)
    const fingerprint = await computeSchemaFingerprint(target)
    if (
      storedMatch &&
      storedMatch[1] === fingerprint &&
      storedMatch[2] === schemaSha
    ) {
      await truncatePublicTables(target)
      return
    }
    await target.query(
      'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
    )
    await loadDump()
    // Re-read: the fingerprint of the schema the dump just built is what the
    // next prepare must find to take the truncate path. Only hex digits, `=`
    // and `;` follow — safe to quote literally.
    const replayed = await computeSchemaFingerprint(target)
    await target.query(
      `COMMENT ON DATABASE ${databaseName} IS 'fingerprint=${replayed};schema=${schemaSha}'`
    )
  } finally {
    await target.end()
  }
}
