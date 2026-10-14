#!/usr/bin/env -S node scripts/run.cjs
/**
 * The migration CLI behind `yarn migrate`, `yarn migrate:status`,
 * `yarn migrate:down`, `yarn migrate:unlock` and `yarn migrate:make`
 * (lib/database/migrate).
 *
 * Usage:
 *   node scripts/run.cjs scripts/database/migrate.ts latest
 *   node scripts/run.cjs scripts/database/migrate.ts status
 *   node scripts/run.cjs scripts/database/migrate.ts down
 *   node scripts/run.cjs scripts/database/migrate.ts unlock
 *   node scripts/run.cjs scripts/database/migrate.ts make <name>
 *
 * - `latest` applies every pending migration. On a database the Knex
 *   migrations built, the first run records the baseline without changing
 *   the schema; an empty database gets the baseline schema; a database behind
 *   v1.192.34 is refused before anything is written. On SQLite a second run
 *   is refused while one holds the lock row in `kysely_migration_lock`.
 * - `status` lists the applied and pending migrations and the handover state,
 *   and on SQLite a held lock row. It only reads: it creates no table (and no
 *   SQLite file), so it can run against production before a deploy. Exits 1
 *   when `latest` would refuse the database (a held SQLite lock included) or
 *   it has migrations this checkout does not know.
 * - `down` rolls back the last migration applied; never the baseline.
 * - `unlock` releases the SQLite lock row a killed run left held; it does not
 *   create a missing SQLite file (exit 1). PostgreSQL's lock is an advisory
 *   lock its connection releases: it only connects (`select 1`), so a wrong
 *   configuration fails, and has nothing to unlock.
 * - `make <name>` writes `migrations/<yyyymmddhhmmss>_<name>.ts` from
 *   migrations/migration.stub. Register it in migrations/index.ts and its
 *   name in migrations/names.ts.
 *
 * The database is the one the Knex CLI used: the `ACTIVITIES_DATABASE` JSON,
 * or the `ACTIVITIES_DATABASE_*` variables (a bare
 * `ACTIVITIES_DATABASE_SQLITE_FILENAME` means SQLite), or
 * `./activities.sqlite` when nothing is set, with `.env*` files loaded by
 * dotenv-flow (lib/config/knexfile.js). It is printed before anything runs.
 */
import dotenvFlow from 'dotenv-flow'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  type DatabaseConfig,
  parseKnexDatabaseConfig
} from '@/lib/config/database'
import { getKnexfileDatabaseConfig } from '@/lib/config/knexfile.js'
import { createDatabaseConnection } from '@/lib/database/connection'
import { inTransaction } from '@/lib/database/kysely'
import {
  BASELINE_MIGRATION,
  type MigrationStatus,
  type MigrationTarget,
  getMigrationLockState,
  getMigrationStatus,
  migrateDown,
  migrateToLatest,
  unlockMigrations
} from '@/lib/database/migrate'

import { describeConnection } from '../fitness/describeConnection'

const MIGRATIONS_DIRECTORY = 'migrations'
const STUB = path.join(MIGRATIONS_DIRECTORY, 'migration.stub')

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// The Knex CLI's configuration leaves every ACTIVITIES_DATABASE_* setting
// that is not set as an undefined (or, for `ssl`, null) key; those are not
// settings, so they are dropped rather than reported as ignored.
const withoutUnsetValues = (config: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(config)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        key === 'connection' && isObject(value)
          ? Object.fromEntries(
              Object.entries(value).filter(
                ([, setting]) => setting !== undefined && setting !== null
              )
            )
          : value
      ])
  )

/**
 * The database `yarn migrate` runs on, resolved as the Knex CLI resolved it
 * (see the top of this file). Call after the `.env*` files are loaded.
 */
export const getMigrationDatabaseConfig = (): DatabaseConfig =>
  parseKnexDatabaseConfig(
    withoutUnsetValues(getKnexfileDatabaseConfig() as Record<string, unknown>)
  )

const describeHandover = (handover: MigrationStatus['handover']) => {
  switch (handover.kind) {
    case 'recorded':
      return `recorded: ${BASELINE_MIGRATION} is applied.`
    case 'knex-complete':
      return (
        'ready: knex_migrations has every Knex migration, so `yarn migrate` ' +
        'records the baseline without changing the schema.'
      )
    case 'empty':
      return 'empty database: `yarn migrate` loads the baseline schema.'
    case 'refused':
      return `REFUSED (${handover.reason}): ${handover.message}`
  }
}

/** The status report `yarn migrate:status` prints. */
export const formatStatus = (status: MigrationStatus): string => {
  const lines = [`Handover: ${describeHandover(status.handover)}`]
  lines.push(`Applied (${status.executed.length}):`)
  for (const { name, executedAt } of status.executed) {
    lines.push(`  ${name}  ${executedAt}`)
  }
  lines.push(`Pending (${status.pending.length}):`)
  for (const name of status.pending) lines.push(`  ${name}`)
  if (status.unknown.length > 0) {
    lines.push(
      `Applied, but not in this checkout (${status.unknown.length}):`,
      ...status.unknown.map((name) => `  ${name}`)
    )
  }
  return lines.join('\n')
}

/** Whether `status` is a database `yarn migrate` cannot run on. */
export const isBlockingStatus = (status: MigrationStatus) =>
  status.handover.kind === 'refused' || status.unknown.length > 0

/**
 * Reads the status without writing: on PostgreSQL in a read-only
 * transaction, which the server enforces.
 */
export const readStatus = (target: MigrationTarget) =>
  inTransaction(
    target.db,
    (trx) => getMigrationStatus({ db: trx, config: target.config }),
    target.config.client === 'pg' ? { accessMode: 'read only' } : {}
  )

/** The line `yarn migrate:status` adds when the SQLite lock row is held. */
export const LOCK_HELD_STATUS =
  'Lock: held: kysely_migration_lock is locked, so `yarn migrate` would be ' +
  'refused. Another run is going on, or one was interrupted; if none is ' +
  'running, release it with `yarn migrate:unlock`.'

// Whether `config` is a SQLite file that does not exist: opening it would
// create it.
const isMissingSqliteFile = (config: DatabaseConfig) =>
  config.client === 'better-sqlite3' &&
  config.connection.filename !== ':memory:' &&
  !existsSync(config.connection.filename)

const formatTimestamp = (date: Date) =>
  [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds()
  ]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('')

/**
 * Writes a new migration from the stub and returns its path. The name is
 * letters, digits and underscores.
 */
export const makeMigration = async (
  name: string | undefined,
  { now = new Date(), cwd = process.cwd() } = {}
): Promise<string> => {
  if (!name || !/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      'Usage: yarn migrate:make <name>, where the name is letters, digits ' +
        'and underscores'
    )
  }
  const file = path.join(
    MIGRATIONS_DIRECTORY,
    `${formatTimestamp(now)}_${name}.ts`
  )
  await writeFile(path.join(cwd, file), await readFile(path.join(cwd, STUB)), {
    flag: 'wx'
  })
  return file
}

const withDatabase = async <T>(
  config: DatabaseConfig,
  run: (target: MigrationTarget) => Promise<T>
): Promise<T> => {
  const connection = createDatabaseConnection(config)
  try {
    return await run({ db: connection.db, config })
  } finally {
    await connection.destroy()
  }
}

const COMMANDS = ['latest', 'status', 'down', 'unlock', 'make'] as const

export const runMigrateCommand = async (args: string[]): Promise<number> => {
  const [command, ...rest] = args
  if (!COMMANDS.includes(command as (typeof COMMANDS)[number])) {
    console.error(
      'Usage: scripts/database/migrate.ts latest | status | down | unlock | ' +
        'make <name>'
    )
    return 1
  }

  if (command === 'make') {
    const file = await makeMigration(rest[0])
    console.log(
      `Created ${file}. Register it in migrations/index.ts and its name in ` +
        'migrations/names.ts.'
    )
    return 0
  }

  dotenvFlow.config()
  const config = getMigrationDatabaseConfig()
  // Which database this runs on, before anything connects. Not the recovery
  // scripts' LOCAL warning: `yarn migrate` runs against local databases all
  // the time (development, the Docker build).
  const { client, target } = describeConnection(config)
  console.log(`Database: ${client} — ${target}`)

  if (command === 'status') {
    if (isMissingSqliteFile(config)) {
      console.log(
        'The database file does not exist yet: `yarn migrate` creates it ' +
          'and loads the baseline schema.'
      )
      return 0
    }
    const { status, lock } = await withDatabase(config, async (target) => ({
      status: await readStatus(target),
      lock: await getMigrationLockState(target)
    }))
    console.log(formatStatus(status))
    if (lock === 'held') console.log(LOCK_HELD_STATUS)
    return isBlockingStatus(status) || lock === 'held' ? 1 : 0
  }

  if (command === 'unlock') {
    if (isMissingSqliteFile(config)) {
      // A lock row lives in the file, so a missing file holds none; most
      // likely the file name is wrong.
      console.log(
        'The database file does not exist, so it holds no migration lock; ' +
          'it was not created. Check the database settings above.'
      )
      return 1
    }
    const result = await withDatabase(config, unlockMigrations)
    console.log(
      result === 'released'
        ? 'Released the migration lock (kysely_migration_lock).'
        : result === 'not-held'
          ? 'The migration lock was not held; nothing to release.'
          : 'PostgreSQL: the migration lock is an advisory lock that ends ' +
            'with the connection holding it; nothing to release.'
    )
    return 0
  }

  if (command === 'down') {
    const name = await withDatabase(config, migrateDown)
    console.log(`Rolled back ${name}.`)
    return 0
  }

  const applied = await withDatabase(config, migrateToLatest)
  console.log(
    applied.length === 0
      ? 'Already up to date.'
      : `Applied ${applied.length} migration(s):\n${applied
          .map((name) => `  ${name}`)
          .join('\n')}`
  )
  return 0
}

if (require.main === module) {
  runMigrateCommand(process.argv.slice(2))
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
