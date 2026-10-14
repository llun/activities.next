import fs from 'fs/promises'
import { type Kysely, sql } from 'kysely'
import os from 'os'
import path from 'path'

import type { DatabaseConfig } from '@/lib/config/database'
import {
  type DatabaseHandle,
  createDatabaseConnection
} from '@/lib/database/connection'
import { getSQLDatabase } from '@/lib/database/getSQLDatabase'
import { type DB, inTransaction } from '@/lib/database/kysely'
import {
  BASELINE_MIGRATION,
  LAST_KNEX_RELEASE,
  MIGRATION_LOCKED_MESSAGE,
  MigrationRunError,
  getAppliedMigrationNames,
  getKnownMigrationNames,
  getMigrationLockState,
  getMigrationStatus,
  migrateDown,
  migrateToLatest,
  normalizeMigrationNames,
  unlockMigrations
} from '@/lib/database/migrate'
import { splitSqliteScript } from '@/lib/database/migrate/baseline'
import { LEGACY_KNEX_MIGRATIONS } from '@/lib/database/migrate/legacyKnexMigrations'
import type { MigrationRegistry } from '@/lib/database/migrate/types'
import {
  getTestDatabaseConfig,
  getTestPgDatabaseName
} from '@/lib/database/testing/createTestDatabase'
import {
  getTestPgConnection,
  recreatePgDatabase
} from '@/lib/database/testing/postgres'
import { migrations } from '@/migrations/index'
import { MIGRATION_NAMES } from '@/migrations/names'

// Runs on SQLite by default and on PostgreSQL under TEST_DATABASE_TYPE=pg.
// Every test starts from an empty database (a new SQLite file, or the
// worker's isolated PostgreSQL database recreated) and runs the real
// migrations, or a registry of its own. `knex_migrations` is only rows here:
// the tests build the state the Knex migrations left without Knex.
const backend = process.env.TEST_DATABASE_TYPE === 'pg' ? 'pg' : 'sqlite'

// oxlint-disable-next-line typescript/no-explicit-any
type AnyDb = Kysely<any>

const asAny = (db: Kysely<DB>) => db as unknown as AnyDb

// Every schema object, as text, in a stable order.
const readSchema = async (db: Kysely<DB>): Promise<string[]> => {
  if (backend === 'sqlite') {
    const { rows } = await sql<{ entry: string }>`
      select type || ' ' || name || ': ' || coalesce(sql, '') as entry
      from sqlite_master order by type, name
    `.execute(db)
    return rows.map((row) => row.entry)
  }
  const { rows: columns } = await sql<{ entry: string }>`
    select 'column ' || table_name || '.' || column_name || ': ' || data_type
      || ' ' || is_nullable || ' ' || coalesce(column_default, '') as entry
    from information_schema.columns
    where table_schema = current_schema()
    order by table_name, column_name
  `.execute(db)
  const { rows: indexes } = await sql<{ entry: string }>`
    select 'index ' || indexname || ': ' || indexdef as entry
    from pg_indexes where schemaname = current_schema() order by indexname
  `.execute(db)
  const { rows: constraints } = await sql<{ entry: string }>`
    select 'constraint ' || conrelid::regclass::text || '.' || conname || ': '
      || pg_get_constraintdef(oid) as entry
    from pg_constraint
    where connamespace = current_schema()::regnamespace
    order by conrelid::regclass::text, conname
  `.execute(db)
  const { rows: triggers } = await sql<{ entry: string }>`
    select 'trigger ' || tgname || ': ' || pg_get_triggerdef(oid) as entry
    from pg_trigger where not tgisinternal order by tgname
  `.execute(db)
  return [...columns, ...indexes, ...constraints, ...triggers].map(
    (row) => row.entry
  )
}

const isMigrationBookkeeping = (entry: string) => /kysely_migration/.test(entry)

const tableNames = async (db: Kysely<DB>) =>
  (await readSchema(db))
    .map((entry) =>
      backend === 'sqlite'
        ? /^table (\S+):/.exec(entry)?.[1]
        : /^column ([^.]+)\./.exec(entry)?.[1]
    )
    .filter((name): name is string => Boolean(name))
    .filter((name, index, all) => all.indexOf(name) === index)

// The tables the Knex migrations left, without Knex: its bookkeeping tables
// as Knex creates them, holding `names`.
const createKnexBookkeeping = async (
  db: Kysely<DB>,
  names: readonly string[],
  { locked = false } = {}
) => {
  if (backend === 'pg') {
    await sql`
      create table knex_migrations (
        id serial primary key, name varchar(255), batch integer,
        migration_time timestamptz
      )
    `.execute(db)
    await sql`
      create table knex_migrations_lock (
        index serial primary key, is_locked integer
      )
    `.execute(db)
  } else {
    await sql`
      create table knex_migrations (
        id integer not null primary key autoincrement, name varchar(255),
        batch integer, migration_time datetime
      )
    `.execute(db)
    await sql`
      create table knex_migrations_lock (
        "index" integer not null primary key autoincrement, is_locked integer
      )
    `.execute(db)
  }
  await sql`
    insert into knex_migrations_lock (is_locked) values (${locked ? 1 : 0})
  `.execute(db)
  for (const [index, name] of names.entries()) {
    await sql`
      insert into knex_migrations (name, batch, migration_time)
      values (${name}, ${index + 1}, ${new Date(Date.UTC(2026, 0, 1) + index)})
    `.execute(db)
  }
}

const loadBaselineFile = async (connection: DatabaseHandle) => {
  const script = await fs.readFile(
    path.join(
      process.cwd(),
      'migrations',
      'baseline',
      backend === 'pg' ? 'postgres.sql' : 'sqlite.sql'
    ),
    'utf8'
  )
  await connection.executeScript(script)
}

const countRows = async (db: Kysely<DB>, table: string) => {
  const { rows } = await sql<{ count: number | string }>`
    select count(*) as count from ${sql.table(table)}
  `.execute(db)
  return Number(rows[0].count)
}

// Statements that write: the ones a run refused by the SQLite lock must not
// send.
const isWrite = (statement: string) =>
  /^\s*(insert|update|delete|create|drop|alter|replace)\b/i.test(statement)

const readLockRows = async (db: Kysely<DB>) => {
  const { rows } = await sql<{ id: string; is_locked: number }>`
    select id, is_locked from kysely_migration_lock
  `.execute(db)
  return rows.map((row) => ({ id: row.id, is_locked: Number(row.is_locked) }))
}

describe('lib/database/migrate', () => {
  let tempDir: string
  let config: DatabaseConfig
  let connection: DatabaseHandle
  let target: { db: Kysely<DB>; config: DatabaseConfig }
  let databaseCount = 0

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-test-'))
  })

  afterAll(async () => {
    await fs.rm(tempDir, { force: true, recursive: true })
  })

  beforeEach(async () => {
    if (backend === 'pg') {
      await recreatePgDatabase(
        getTestPgConnection(),
        getTestPgDatabaseName(true)
      )
      config = getTestDatabaseConfig('pg', true)
    } else {
      databaseCount += 1
      config = {
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: {
          filename: path.join(tempDir, `migrate-${databaseCount}.sqlite`)
        }
      }
    }
    connection = createDatabaseConnection(config)
    target = { db: connection.db, config }
  })

  afterEach(async () => {
    await connection.destroy()
  })

  describe('the registry', () => {
    it('registers every migration file, the baseline first', async () => {
      const files = (await fs.readdir(path.join(process.cwd(), 'migrations')))
        .filter((file) => /^\d{14}_\w+\.ts$/.test(file))
        .map((file) => file.replace(/\.ts$/, ''))
        .sort()
      const known = await getKnownMigrationNames()

      expect(known).toEqual(files)
      expect(known[0]).toBe(BASELINE_MIGRATION)
      expect(Object.keys(migrations).sort()).toEqual(known)
      // The names the startup check reads without loading the modules.
      expect([...MIGRATION_NAMES].sort()).toEqual(known)
    })

    it('freezes every legacy Knex migration file', async () => {
      const files = (
        await fs.readdir(path.join(process.cwd(), 'migrations', 'legacy'))
      )
        .filter((file) => file.endsWith('.js'))
        .sort()

      expect(LEGACY_KNEX_MIGRATIONS).toEqual(files)
      expect(LEGACY_KNEX_MIGRATIONS).toHaveLength(181)
      // The baseline sorts after every one of them.
      expect(
        LEGACY_KNEX_MIGRATIONS.every((name) => name < BASELINE_MIGRATION)
      ).toBe(true)
    })
  })

  describe('an empty database', () => {
    it('loads the baseline: the schema the reference dump describes', async () => {
      expect(await getMigrationStatus(target)).toMatchObject({
        executed: [],
        pending: [BASELINE_MIGRATION],
        handover: { kind: 'empty' }
      })

      expect(await migrateToLatest(target)).toEqual([BASELINE_MIGRATION])
      const migrated = await readSchema(connection.db)

      // The schema the test databases load from migrations/schema*.sql, in a
      // database of its own (on PostgreSQL the same one, recreated).
      await connection.destroy()
      if (backend === 'pg') {
        await recreatePgDatabase(
          getTestPgConnection(),
          getTestPgDatabaseName(true)
        )
      }
      connection = createDatabaseConnection(
        backend === 'pg' ? config : getTestDatabaseConfig('sqlite')
      )
      const dump = await fs.readFile(
        path.join(
          process.cwd(),
          'migrations',
          backend === 'pg' ? 'schema.sql' : 'schema.sqlite.sql'
        ),
        'utf8'
      )
      // pg_dump 17's `SET transaction_timeout` is unknown before 17.
      await connection.executeScript(
        dump.replace(/^SET transaction_timeout = 0;$/m, '')
      )
      expect(migrated).toEqual(await readSchema(connection.db))
    })

    it('records the baseline once: a second run is a no-op', async () => {
      expect(await migrateToLatest(target)).toEqual([BASELINE_MIGRATION])
      const schema = await readSchema(connection.db)

      expect(await migrateToLatest(target)).toEqual([])
      expect(await readSchema(connection.db)).toEqual(schema)
      expect(await countRows(connection.db, 'kysely_migration')).toBe(1)
      expect(await getMigrationStatus(target)).toMatchObject({
        pending: [],
        unknown: [],
        handover: { kind: 'recorded' }
      })
      expect(await getAppliedMigrationNames(target)).toEqual([
        BASELINE_MIGRATION
      ])
      // Read inside a transaction too, as the production archive does.
      await expect(
        inTransaction(connection.db, (trx) =>
          getAppliedMigrationNames({ db: trx, config })
        )
      ).resolves.toEqual([BASELINE_MIGRATION])
    })

    it('reports zero nodeinfo and servicestat counters on a fresh install', async () => {
      await migrateToLatest(target)
      // The Knex chain seeded zero-valued nodeinfo:* and servicestat:*
      // counters on an empty database; the baseline does not, and both read
      // as zero.
      const { rows } = await sql<{ id: string }>`
        select id from counters
      `.execute(connection.db)
      expect(rows).toEqual([])

      expect(await getSQLDatabase(connection.db).getNodeInfoStats()).toEqual({
        totalUsers: 0,
        activeMonth: 0,
        activeHalfyear: 0,
        localPosts: 0
      })
      expect(
        await getSQLDatabase(connection.db).getServiceStats()
      ).toMatchObject({ totalAccounts: 0, totalActors: 0, totalStatuses: 0 })
    })

    it('reads the status without creating any table', async () => {
      const before = await readSchema(connection.db)
      await getMigrationStatus(target)
      expect(await readSchema(connection.db)).toEqual(before)
      expect(await tableNames(connection.db)).toEqual([])
    })
  })

  describe('a database the Knex migrations built', () => {
    // The baseline schema plus Knex's bookkeeping, as production has it.
    const buildKnexDatabase = async (
      names: readonly string[] = LEGACY_KNEX_MIGRATIONS,
      options: { locked?: boolean } = {}
    ) => {
      await loadBaselineFile(connection)
      await createKnexBookkeeping(connection.db, names, options)
    }

    it('records the baseline without running any DDL, and leaves the Knex tables', async () => {
      // Two names as they were before the `.ts` to `.js` rename.
      await buildKnexDatabase(
        LEGACY_KNEX_MIGRATIONS.map((name, index) =>
          index < 2 ? name.replace(/\.js$/, '.ts') : name
        )
      )
      await sql`
        insert into counters (id, value) values ('kept', 3)
      `.execute(connection.db)
      const schemaBefore = await readSchema(connection.db)
      const knexBefore = await sql`
        select * from knex_migrations order by id
      `.execute(connection.db)

      expect((await getMigrationStatus(target)).handover).toEqual({
        kind: 'knex-complete'
      })
      expect(await getAppliedMigrationNames(target)).toEqual([
        BASELINE_MIGRATION
      ])

      const statements: string[] = []
      const stop = connection.onQuery(({ sql: statement }) => {
        statements.push(statement)
      })
      try {
        expect(await migrateToLatest(target)).toEqual([BASELINE_MIGRATION])
      } finally {
        stop()
      }

      // The only DDL creates the Migrator's own tables.
      const ddl = statements.filter((statement) =>
        /^\s*(create|alter|drop)\b/i.test(statement)
      )
      expect(ddl).toHaveLength(2)
      expect(ddl.every((statement) => /kysely_migration/.test(statement))).toBe(
        true
      )
      const schemaAfter = await readSchema(connection.db)
      expect(
        schemaAfter.filter((entry) => !isMigrationBookkeeping(entry))
      ).toEqual(schemaBefore)
      expect(
        (await tableNames(connection.db)).filter((name) =>
          name.startsWith('kysely_migration')
        )
      ).toEqual(['kysely_migration', 'kysely_migration_lock'])

      // Knex's tables are untouched, so a pre-handover image finds every
      // migration applied.
      expect(
        await sql`select * from knex_migrations order by id`.execute(
          connection.db
        )
      ).toEqual(knexBefore)
      expect(await countRows(connection.db, 'knex_migrations_lock')).toBe(1)
      const { rows } = await sql<{ value: number }>`
        select value from counters where id = 'kept'
      `.execute(connection.db)
      expect(rows).toEqual([{ value: 3 }])

      expect(await migrateToLatest(target)).toEqual([])
      expect((await getMigrationStatus(target)).handover).toEqual({
        kind: 'recorded'
      })
    })

    const expectRefusedWithoutWrites = async (message: string) => {
      const before = await readSchema(connection.db)
      await expect(migrateToLatest(target)).rejects.toThrow(message)
      // Refused before the Migrator created its tables.
      expect(await readSchema(connection.db)).toEqual(before)
      expect(await tableNames(connection.db)).not.toContain('kysely_migration')
    }

    it('refuses one missing Knex migration, naming a release with every Knex migration', async () => {
      const missing = LEGACY_KNEX_MIGRATIONS[100]
      await buildKnexDatabase(
        LEGACY_KNEX_MIGRATIONS.filter((name) => name !== missing)
      )

      const { handover } = await getMigrationStatus(target)
      expect(handover).toMatchObject({
        kind: 'refused',
        reason: 'knex-missing'
      })
      await expectRefusedWithoutWrites(
        `has not applied 1 of the 181 Knex migrations this release starts ` +
          `from (the first missing one is ${missing.replace(/\.js$/, '')}). ` +
          `Upgrade to ${LAST_KNEX_RELEASE}`
      )
    })

    it('refuses a Knex migration no release has', async () => {
      await buildKnexDatabase([
        ...LEGACY_KNEX_MIGRATIONS,
        '29990101000000_branch_only.js'
      ])

      expect((await getMigrationStatus(target)).handover).toMatchObject({
        kind: 'refused',
        reason: 'knex-unknown'
      })
      await expectRefusedWithoutWrites(
        'has applied 1 Knex migration(s) that no release has (v1.192.34 and ' +
          'the releases after it up to this one have the same 181; the first ' +
          'unknown one is 29990101000000_branch_only)'
      )
    })

    it('refuses while knex_migrations_lock is held', async () => {
      await buildKnexDatabase(LEGACY_KNEX_MIGRATIONS, { locked: true })

      expect((await getMigrationStatus(target)).handover).toMatchObject({
        kind: 'refused',
        reason: 'knex-locked'
      })
      await expectRefusedWithoutWrites('knex_migrations_lock is locked')
    })

    it('refuses application tables without any migration history', async () => {
      await loadBaselineFile(connection)

      expect((await getMigrationStatus(target)).handover).toMatchObject({
        kind: 'refused',
        reason: 'unknown-schema'
      })
      await expectRefusedWithoutWrites(
        'has application tables (accounts, actors) but no migration history'
      )
    })

    it('refuses inside the baseline too, under the lock, when the pre-check passed', async () => {
      // A Knex run that started between the pre-check and the baseline.
      await buildKnexDatabase()
      const registry: MigrationRegistry = {
        ...migrations,
        '20261013000000_lock_knex': {
          up: async (db) => {
            await sql`update knex_migrations_lock set is_locked = 1`.execute(db)
          }
        }
      }

      await expect(migrateToLatest(target, registry)).rejects.toThrow(
        `Migration ${BASELINE_MIGRATION} failed: knex_migrations_lock is locked`
      )
      expect(await getAppliedMigrationNames(target)).toEqual([
        '20261013000000_lock_knex'
      ])
    })
  })

  describe('the runner', () => {
    const createTable = (table: string) => async (db: AnyDb) => {
      await db.schema
        .createTable(table)
        .addColumn('id', 'integer', (column) => column.primaryKey())
        .execute()
      await db.insertInto(table).values({ id: 1 }).execute()
    }

    it('runs each migration in a transaction of its own: a failure rolls back that one alone', async () => {
      const registry: MigrationRegistry = {
        '20300101000000_first': { up: createTable('first_table') },
        '20300102000000_second': {
          up: async (db) => {
            await createTable('second_table')(db)
            throw new Error('second failed')
          }
        },
        '20300103000000_third': { up: createTable('third_table') }
      }

      const failure = await migrateToLatest(target, registry).catch(
        (error: unknown) => error
      )
      expect(failure).toBeInstanceOf(MigrationRunError)
      expect((failure as Error).message).toBe(
        'Migration 20300102000000_second failed: second failed'
      )

      const tables = await tableNames(connection.db)
      expect(tables).toContain('first_table')
      expect(tables).not.toContain('second_table')
      expect(tables).not.toContain('third_table')
      expect(await getAppliedMigrationNames(target)).toEqual([
        '20300101000000_first'
      ])
      // The SQLite lock row is released after a failed run too.
      expect(await readLockRows(connection.db)).toEqual([
        { id: 'migration_lock', is_locked: 0 }
      ])
    })

    it('opens a transaction per migration, and none for config.transaction = false', async () => {
      const registry: MigrationRegistry = {
        '20300101000000_in_transaction': { up: createTable('in_transaction') },
        '20300102000000_bare': {
          up: createTable('bare'),
          config: { transaction: false }
        }
      }
      const statements: string[] = []
      const stop = connection.onQuery(({ sql: statement }) => {
        statements.push(statement.trim().toLowerCase())
      })
      try {
        await migrateToLatest(target, registry)
      } finally {
        stop()
      }

      const around = (table: string) => {
        const create = statements.findIndex((statement) =>
          statement.startsWith(`create table "${table}"`)
        )
        return [statements[create - 1], statements[create + 2]]
      }
      expect(around('in_transaction')).toEqual(['begin', 'commit'])
      expect(around('bare')).not.toContain('begin')
      expect(
        statements.filter((statement) => statement === 'begin')
      ).toHaveLength(1)
    })

    it('runs a migration that sorts before one already applied', async () => {
      const later = { up: createTable('later_table') }
      await migrateToLatest(target, { '20300102000000_later': later })

      expect(
        await migrateToLatest(target, {
          '20300101000000_earlier': { up: createTable('earlier_table') },
          '20300102000000_later': later
        })
      ).toEqual(['20300101000000_earlier'])
      expect(await getAppliedMigrationNames(target)).toEqual([
        '20300102000000_later',
        '20300101000000_earlier'
      ])
    })

    it('rolls back the last migration, but never the baseline', async () => {
      const registry: MigrationRegistry = {
        ...migrations,
        '20300101000000_probe': {
          up: createTable('probe'),
          down: async (db) => {
            await db.schema.dropTable('probe').execute()
          }
        }
      }
      await expect(migrateDown(target, registry)).rejects.toThrow(
        'Nothing to roll back: no migration has been applied.'
      )
      await migrateToLatest(target, registry)

      expect(await migrateDown(target, registry)).toBe('20300101000000_probe')
      expect(await tableNames(connection.db)).not.toContain('probe')
      expect(await getAppliedMigrationNames(target)).toEqual([
        BASELINE_MIGRATION
      ])

      const schema = await readSchema(connection.db)
      await expect(migrateDown(target, registry)).rejects.toThrow(
        `Nothing to roll back above the baseline: ${BASELINE_MIGRATION}`
      )
      expect(await readSchema(connection.db)).toEqual(schema)
      expect(await getAppliedMigrationNames(target)).toEqual([
        BASELINE_MIGRATION
      ])
      // The baseline's own down refuses too.
      await expect(
        migrations[BASELINE_MIGRATION].down?.(asAny(connection.db))
      ).rejects.toThrow('cannot be rolled back')
    })

    it('refuses to migrate inside a transaction', async () => {
      await expect(
        inTransaction(connection.db, (trx) =>
          migrateToLatest({ db: trx, config })
        )
      ).rejects.toThrow('Cannot migrate inside a transaction')
      await expect(
        inTransaction(connection.db, (trx) => migrateDown({ db: trx, config }))
      ).rejects.toThrow('Cannot migrate inside a transaction')
    })

    it.runIf(backend === 'sqlite')(
      'migrates an in-memory SQLite database on the connection it is given',
      async () => {
        // Knex ran migrations on a connection of its own, so this used to be
        // refused: that connection would have opened another, empty database.
        const memoryConfig = getTestDatabaseConfig('sqlite')
        const memory = createDatabaseConnection(memoryConfig)
        try {
          const memoryTarget = { db: memory.db, config: memoryConfig }
          expect(await migrateToLatest(memoryTarget)).toEqual([
            BASELINE_MIGRATION
          ])
          expect(await getAppliedMigrationNames(memoryTarget)).toEqual([
            BASELINE_MIGRATION
          ])
          expect(await countRows(memory.db, 'accounts')).toBe(0)
        } finally {
          await memory.destroy()
        }
      }
    )

    it('refuses the root instance inside a migration', async () => {
      await expect(
        migrateToLatest(target, {
          '20300101000000_root': {
            up: async () => {
              await sql`select 1`.execute(connection.db)
            }
          }
        })
      ).rejects.toThrow('The root Kysely instance was used')
    })

    it.runIf(backend === 'pg')(
      'serialises two concurrent runs on the advisory lock',
      async () => {
        const other = createDatabaseConnection(config)
        const statements: string[] = []
        const stops = [connection, other].map((handle) =>
          handle.onQuery(({ sql: statement }) => {
            statements.push(statement)
          })
        )
        try {
          const results = await Promise.all([
            migrateToLatest(target),
            migrateToLatest({ db: other.db, config })
          ])
          expect(results.flat()).toEqual([BASELINE_MIGRATION])
          expect(await countRows(connection.db, 'kysely_migration')).toBe(1)
          // The SQLite lock row is not used here: the advisory lock is.
          expect(
            statements.filter((statement) =>
              /^\s*update\s+"kysely_migration_lock"/i.test(statement)
            )
          ).toEqual([])
          expect(await readLockRows(connection.db)).toEqual([
            { id: 'migration_lock', is_locked: 0 }
          ])
          // It connects, and writes nothing.
          expect(await unlockMigrations(target)).toBe('advisory')
          expect(statements.at(-1)?.trim()).toBe('select 1')
        } finally {
          for (const stop of stops) stop()
          await other.destroy()
        }
      }
    )

    it.runIf(backend === 'sqlite')(
      'refuses a second run on the same SQLite file while the first holds the lock',
      async () => {
        const other = createDatabaseConnection(config)
        let release!: () => void
        const gate = new Promise<void>((resolve) => (release = resolve))
        let entered!: () => void
        const inside = new Promise<void>((resolve) => (entered = resolve))
        let calls = 0
        const registry: MigrationRegistry = {
          ...migrations,
          '20300101000000_slow': {
            // Only the first run waits: without the lock the second would run
            // it again, and finish, instead of being refused.
            up: async () => {
              calls += 1
              if (calls > 1) return
              entered()
              await gate
            }
          }
        }
        let first: Promise<string[]> | undefined
        try {
          first = migrateToLatest(target, registry)
          await inside
          // Refused after reading the lock row, without a write, so it never
          // takes SQLite's write lock while the first run is migrating.
          const refusedStatements: string[] = []
          const stop = other.onQuery(({ sql: statement }) => {
            refusedStatements.push(statement)
          })
          try {
            await expect(
              migrateToLatest({ db: other.db, config }, registry)
            ).rejects.toThrow(MIGRATION_LOCKED_MESSAGE)
          } finally {
            stop()
          }
          expect(refusedStatements.length).toBeGreaterThan(0)
          expect(refusedStatements.filter(isWrite)).toEqual([])
          release()
          expect(await first).toEqual([
            BASELINE_MIGRATION,
            '20300101000000_slow'
          ])
          expect(calls).toBe(1)

          // Released: the second connection runs now, with nothing to do.
          expect(await readLockRows(other.db)).toEqual([
            { id: 'migration_lock', is_locked: 0 }
          ])
          expect(
            await migrateToLatest({ db: other.db, config }, registry)
          ).toEqual([])
          // The Migrator's tables, in the order it creates them, so the
          // schema dump is unchanged.
          const { rows } = await sql<{ name: string }>`
            select name from sqlite_master
            where name like 'kysely%' and type = 'table' order by rowid
          `.execute(other.db)
          expect(rows.map((row) => row.name)).toEqual([
            'kysely_migration',
            'kysely_migration_lock'
          ])
        } finally {
          release()
          await first?.catch(() => {})
          await other.destroy()
        }
      }
    )

    it.runIf(backend === 'sqlite')(
      'keeps the lock a killed run left until it is unlocked',
      async () => {
        expect(await unlockMigrations(target)).toBe('not-held')
        expect(await getMigrationLockState(target)).toBe('free')
        await migrateToLatest(target)
        expect(await getMigrationLockState(target)).toBe('free')
        // What a run killed while it held the lock leaves behind.
        await sql`
          update kysely_migration_lock set is_locked = 1
        `.execute(connection.db)
        expect(await getMigrationLockState(target)).toBe('held')

        const statements: string[] = []
        const stop = connection.onQuery(({ sql: statement }) => {
          statements.push(statement)
        })
        try {
          await expect(migrateToLatest(target)).rejects.toThrow(
            MIGRATION_LOCKED_MESSAGE
          )
        } finally {
          stop()
        }
        // Refused without a write.
        expect(statements.filter(isWrite)).toEqual([])
        expect(await unlockMigrations(target)).toBe('released')
        expect(await readLockRows(connection.db)).toEqual([
          { id: 'migration_lock', is_locked: 0 }
        ])
        expect(await unlockMigrations(target)).toBe('not-held')
        expect(await migrateToLatest(target)).toEqual([])
      }
    )

    it.runIf(backend === 'sqlite')(
      'keeps the migration error when the lock cannot be released, and says to unlock',
      async () => {
        // Without its table the release fails, as a release that times out
        // on a busy file would.
        const failing: MigrationRegistry = {
          '20300101000000_drop_and_fail': {
            up: async (db) => {
              await sql`drop table kysely_migration_lock`.execute(db)
              throw new Error('boom')
            },
            config: { transaction: false }
          }
        }
        const failure = await migrateToLatest(target, failing).catch(
          (error: unknown) => error
        )
        expect(failure).toBeInstanceOf(MigrationRunError)
        const message = (failure as Error).message
        expect(message).toMatch(
          /^Migration 20300101000000_drop_and_fail failed: boom\n/
        )
        expect(message).toContain(
          'The migration lock (kysely_migration_lock) could not be released: ' +
            'no such table: kysely_migration_lock.'
        )
        expect(message).toContain('run `yarn migrate:unlock`')
      }
    )

    it.runIf(backend === 'sqlite')(
      'fails a run whose lock cannot be released after it applied, and says to unlock',
      async () => {
        const registry: MigrationRegistry = {
          '20300101000000_drop_lock_table': {
            up: async (db) => {
              await sql`drop table kysely_migration_lock`.execute(db)
            },
            config: { transaction: false }
          }
        }
        const failure = await migrateToLatest(target, registry).catch(
          (error: unknown) => error
        )
        expect(failure).toBeInstanceOf(Error)
        expect((failure as Error).message).toBe(
          'The migrations ran, but the lock stays held. The migration lock ' +
            '(kysely_migration_lock) could not be released: no such table: ' +
            'kysely_migration_lock. If no run is going on, run ' +
            '`yarn migrate:unlock`.'
        )
        expect(await getAppliedMigrationNames(target)).toEqual([
          '20300101000000_drop_lock_table'
        ])
      }
    )
  })

  describe('migration names', () => {
    it('reads a complete Knex list as the baseline, and anything else as it is', () => {
      expect(normalizeMigrationNames(LEGACY_KNEX_MIGRATIONS)).toEqual([
        BASELINE_MIGRATION
      ])
      expect(
        normalizeMigrationNames(
          [...LEGACY_KNEX_MIGRATIONS]
            .reverse()
            .map((name) => name.replace(/\.js$/, ''))
        )
      ).toEqual([BASELINE_MIGRATION])
      const partial = LEGACY_KNEX_MIGRATIONS.slice(1)
      expect(normalizeMigrationNames(partial)).toEqual(partial)
      expect(normalizeMigrationNames([])).toEqual([])
      expect(normalizeMigrationNames([BASELINE_MIGRATION])).toEqual([
        BASELINE_MIGRATION
      ])
    })

    it('reports a partly Knex-migrated database by its Knex names', async () => {
      const partial = LEGACY_KNEX_MIGRATIONS.slice(0, 3)
      await createKnexBookkeeping(connection.db, partial)
      expect(await getAppliedMigrationNames(target)).toEqual(partial)
    })
  })

  describe('splitSqliteScript', () => {
    it('splits on statement ends only, keeping trigger bodies whole', () => {
      expect(
        splitSqliteScript(
          [
            '-- a comment; not a statement',
            "CREATE TABLE `a;b` (x text default 'it''s; fine', [y;z] int);",
            'CREATE VIRTUAL TABLE f USING fts5(x)',
            '/* f(x) */;',
            'CREATE TRIGGER t AFTER INSERT ON a BEGIN',
            '  INSERT INTO f(x) VALUES (new.x);',
            '  DELETE FROM f WHERE x = "end";',
            'END;',
            'CREATE INDEX i on a (x);'
          ].join('\n')
        )
      ).toEqual([
        "CREATE TABLE `a;b` (x text default 'it''s; fine', [y;z] int)",
        'CREATE VIRTUAL TABLE f USING fts5(x)\n/* f(x) */',
        [
          'CREATE TRIGGER t AFTER INSERT ON a BEGIN',
          '  INSERT INTO f(x) VALUES (new.x);',
          '  DELETE FROM f WHERE x = "end";',
          'END'
        ].join('\n'),
        'CREATE INDEX i on a (x)'
      ])
    })

    it('finds one statement per CREATE in the SQLite baseline', async () => {
      const script = await fs.readFile(
        path.join(process.cwd(), 'migrations', 'baseline', 'sqlite.sql'),
        'utf8'
      )
      const statements = splitSqliteScript(script)
      expect(statements).toHaveLength(script.match(/^CREATE /gm)?.length ?? 0)
      expect(
        statements.every((statement) => statement.startsWith('CREATE '))
      ).toBe(true)
    })
  })
})
