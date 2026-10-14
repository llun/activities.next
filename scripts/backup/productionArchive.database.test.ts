import fs from 'fs/promises'
import { type Kysely, sql } from 'kysely'
import os from 'os'
import path from 'path'

import type { DatabaseConfig } from '@/lib/config/database'
import {
  type QueryEvent,
  createDatabaseConnection
} from '@/lib/database/connection'
import { getSQLDatabase } from '@/lib/database/getSQLDatabase'
import {
  getAppliedMigrationNames,
  getKnownMigrationNames,
  migrateToLatest
} from '@/lib/database/migrate'
import {
  getTestDatabaseConfig,
  getTestPgDatabaseName
} from '@/lib/database/testing/createTestDatabase'
import {
  getTestPgConnection,
  recreatePgDatabase
} from '@/lib/database/testing/postgres'
import { seedDatabase } from '@/lib/stub/database'
import { withTimeZone } from '@/lib/testing/withTimeZone'

import {
  type ArchiveDatabase,
  type ArchiveManifest,
  assertArchiveTableFilesReadable,
  assertMatchingMigrations,
  exportDatabase,
  getDatabaseTableNames,
  getRestoreInsertBatchSize,
  openArchiveDatabase,
  readJsonLines,
  restoreDatabase,
  sortTablesForRestore,
  stringifyJsonColumnValues,
  truncateTables
} from './productionArchive'

const sqliteMemoryConfig = getTestDatabaseConfig('sqlite')

// The archive's own kind of connection (results not normalised) on an in-memory
// SQLite database, with the statements it sends.
const openSqliteArchiveDatabase = () => {
  const connection = createDatabaseConnection(sqliteMemoryConfig, {
    normalizeResults: false
  })
  const statements: QueryEvent[] = []
  connection.onQuery((event) => {
    statements.push(event)
  })
  const database: ArchiveDatabase = {
    config: sqliteMemoryConfig,
    db: connection.db
  }
  return {
    database,
    // The archive reads and writes tables the generated types do not know.
    // oxlint-disable-next-line typescript/no-explicit-any
    tableDb: connection.db as unknown as Kysely<any>,
    statements,
    destroy: connection.destroy
  }
}

// Inserts `rows` in batches of 200, as the tests' Knex `batchInsert` did.
const insertRows = async (
  // oxlint-disable-next-line typescript/no-explicit-any
  tableDb: Kysely<any>,
  tableName: string,
  rows: Record<string, unknown>[]
) => {
  for (let index = 0; index < rows.length; index += 200) {
    await tableDb
      .insertInto(tableName)
      .values(rows.slice(index, index + 200))
      .execute()
  }
}

describe('production archive scripts', () => {
  describe('readJsonLines', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'json-lines-test-'))
    })

    afterEach(async () => {
      await fs.rm(tempDir, { force: true, recursive: true })
    })

    it('does not split JSON rows on Unicode line separators inside strings', async () => {
      const lineSeparator = String.fromCharCode(0x2028)
      const filePath = path.join(tempDir, 'rows.jsonl')
      const rows = [
        { id: 'one', summary: `hello${lineSeparator}world` },
        { id: 'two', summary: 'next row' }
      ]

      await fs.writeFile(
        filePath,
        rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
      )

      await expect(Array.fromAsync(readJsonLines(filePath))).resolves.toEqual(
        rows
      )
    })
  })

  describe('stringifyJsonColumnValues', () => {
    it('stringifies values for JSON columns before pg insertion', () => {
      expect(
        stringifyJsonColumnValues(
          {
            code: 'abc',
            metadata: { nested: true },
            scopes: ['read', 'write'],
            textValue: 'plain'
          },
          new Set(['metadata', 'scopes', 'textValue'])
        )
      ).toEqual({
        code: 'abc',
        metadata: '{"nested":true}',
        scopes: '["read","write"]',
        textValue: '"plain"'
      })
    })
  })

  describe('exportDatabase', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'production-archive-export-test-')
      )
    })

    afterEach(async () => {
      await fs.rm(tempDir, { force: true, recursive: true })
    })

    it('uses SQLite rowid keyset pagination without exporting rowid', async () => {
      const { database, tableDb, statements, destroy } =
        openSqliteArchiveDatabase()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        await sql`create table events (name varchar(255))`.execute(database.db)
        await insertRows(
          tableDb,
          'events',
          Array.from({ length: 1005 }, (_, index) => ({
            name: `event-${index}`
          }))
        )

        const result = await exportDatabase(database, tempDir, {
          includeReferencedStoragePaths: false
        })

        expect(result.manifest.tables).toEqual([
          { name: 'events', rowCount: 1005 }
        ])

        const payload = await fs.readFile(
          path.join(tempDir, 'database', 'events.jsonl'),
          'utf-8'
        )
        const rows = payload
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as Record<string, unknown>)

        expect(rows).toHaveLength(1005)
        expect(rows[0]).toEqual({ name: 'event-0' })
        expect(rows[1004]).toEqual({ name: 'event-1004' })
        expect(rows.every((row) => !('rowid' in row))).toBe(true)
        expect(
          rows.every((row) => {
            return !Object.keys(row).some((key) => {
              return key.startsWith('__activitynext_archive_cursor_')
            })
          })
        ).toBe(true)

        const tableExportStatements = statements
          .map(({ sql }) => sql)
          .filter((statement) => {
            return statement.includes('from "events"')
          })
        expect(
          tableExportStatements.every((statement) => {
            return !statement.toLowerCase().includes('offset')
          })
        ).toBe(true)
        expect(
          tableExportStatements.some((statement) => {
            return (
              statement.includes('"rowid" as') &&
              statement.includes('"rowid" > ?')
            )
          })
        ).toBe(true)
      } finally {
        logSpy.mockRestore()
        await destroy()
      }
    })

    it('uses an unshadowed SQLite rowid cursor for no-primary-key tables', async () => {
      const { database, tableDb, statements, destroy } =
        openSqliteArchiveDatabase()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        await sql`
          create table events (rowid varchar(255), name varchar(255))
        `.execute(database.db)
        await insertRows(
          tableDb,
          'events',
          Array.from({ length: 1005 }, (_, index) => ({
            name: `event-${index}`,
            rowid: 'duplicate-user-value'
          }))
        )

        await exportDatabase(database, tempDir, {
          includeReferencedStoragePaths: false
        })

        const payload = await fs.readFile(
          path.join(tempDir, 'database', 'events.jsonl'),
          'utf-8'
        )
        const rows = payload
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as Record<string, unknown>)

        expect(rows).toHaveLength(1005)
        expect(rows[1004]).toEqual({
          name: 'event-1004',
          rowid: 'duplicate-user-value'
        })
        expect(
          statements.some(({ sql }) => {
            return sql.includes('"_rowid_" as') && sql.includes('"_rowid_" > ?')
          })
        ).toBe(true)
      } finally {
        logSpy.mockRestore()
        await destroy()
      }
    })

    it('treats SQLite rowid cursor shadowing as case-insensitive', async () => {
      const { database, tableDb, statements, destroy } =
        openSqliteArchiveDatabase()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        await sql`
          create table events (ROWID varchar(255), name varchar(255))
        `.execute(database.db)
        await insertRows(
          tableDb,
          'events',
          Array.from({ length: 1005 }, (_, index) => ({
            name: `event-${index}`,
            ROWID: 'duplicate-user-value'
          }))
        )

        await exportDatabase(database, tempDir, {
          includeReferencedStoragePaths: false
        })

        const payload = await fs.readFile(
          path.join(tempDir, 'database', 'events.jsonl'),
          'utf-8'
        )
        const rows = payload
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as Record<string, unknown>)

        expect(rows).toHaveLength(1005)
        expect(rows[1004]).toEqual({
          ROWID: 'duplicate-user-value',
          name: 'event-1004'
        })
        expect(
          statements.some(({ sql }) => {
            return sql.includes('"_rowid_" as') && sql.includes('"_rowid_" > ?')
          })
        ).toBe(true)
      } finally {
        logSpy.mockRestore()
        await destroy()
      }
    })

    it('uses a non-colliding private cursor alias for SQLite rowid export', async () => {
      const { database, tableDb, statements, destroy } =
        openSqliteArchiveDatabase()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        await sql`
          create table events (
            __activitynext_archive_cursor varchar(255),
            __ACTIVITYNEXT_ARCHIVE_CURSOR_1 varchar(255),
            name varchar(255)
          )
        `.execute(database.db)
        await insertRows(
          tableDb,
          'events',
          Array.from({ length: 1005 }, (_, index) => ({
            __ACTIVITYNEXT_ARCHIVE_CURSOR_1: `upper-real-${index}`,
            __activitynext_archive_cursor: `real-${index}`,
            name: `event-${index}`
          }))
        )

        await exportDatabase(database, tempDir, {
          includeReferencedStoragePaths: false
        })

        const payload = await fs.readFile(
          path.join(tempDir, 'database', 'events.jsonl'),
          'utf-8'
        )
        const rows = payload
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as Record<string, unknown>)

        expect(rows).toHaveLength(1005)
        expect(rows[1004]).toEqual({
          __ACTIVITYNEXT_ARCHIVE_CURSOR_1: 'upper-real-1004',
          __activitynext_archive_cursor: 'real-1004',
          name: 'event-1004'
        })
        expect(
          rows.every((row) => {
            return !('__activitynext_archive_cursor_2' in row)
          })
        ).toBe(true)
        expect(
          statements.some(({ sql }) => {
            return sql.includes('as "__activitynext_archive_cursor_2"')
          })
        ).toBe(true)
      } finally {
        logSpy.mockRestore()
        await destroy()
      }
    })
  })

  describe('sortTablesForRestore', () => {
    it('orders parent tables before dependent tables', () => {
      expect(
        sortTablesForRestore(
          ['attachments', 'actors', 'statuses'],
          [
            { fromTable: 'statuses', toTable: 'actors' },
            { fromTable: 'attachments', toTable: 'statuses' }
          ]
        )
      ).toEqual(['actors', 'statuses', 'attachments'])
    })

    it('keeps self references from creating cycles', () => {
      expect(
        sortTablesForRestore(
          ['statuses', 'actors'],
          [
            { fromTable: 'statuses', toTable: 'statuses' },
            { fromTable: 'statuses', toTable: 'actors' }
          ]
        )
      ).toEqual(['actors', 'statuses'])
    })

    it('throws when tables have a foreign-key cycle', () => {
      expect(() =>
        sortTablesForRestore(
          ['actors', 'statuses'],
          [
            { fromTable: 'actors', toTable: 'statuses' },
            { fromTable: 'statuses', toTable: 'actors' }
          ]
        )
      ).toThrow('foreign-key cycle')
    })
  })

  describe('assertMatchingMigrations', () => {
    it('compares migration sets without depending on order', () => {
      expect(() =>
        assertMatchingMigrations(
          ['002_second.js', '001_first.js'],
          ['001_first.js', '002_second.js']
        )
      ).not.toThrow()
    })

    it('reports real migration differences', () => {
      expect(() =>
        assertMatchingMigrations(
          ['001_first.js'],
          ['001_first.js', '002_second.js']
        )
      ).toThrow('Extra locally: 002_second.js')
    })
  })

  describe('getDatabaseTableNames', () => {
    it('excludes SQLite internal and Knex lock tables', async () => {
      const { database, destroy } = openSqliteArchiveDatabase()

      try {
        await sql`create table app_data (id integer primary key)`.execute(
          database.db
        )
        await sql`
          create table knex_migrations_lock (
            "index" integer primary key,
            is_locked integer
          )
        `.execute(database.db)

        await sql`insert into app_data (id) values (1)`.execute(database.db)

        await expect(getDatabaseTableNames(database)).resolves.toEqual([
          'app_data'
        ])
      } finally {
        await destroy()
      }
    })
  })

  describe('getRestoreInsertBatchSize', () => {
    it('uses a conservative SQLite batch size based on column count', async () => {
      const { database, destroy } = openSqliteArchiveDatabase()

      try {
        expect(
          getRestoreInsertBatchSize(database, {
            a: 1,
            b: 2,
            c: 3,
            d: 4,
            e: 5
          })
        ).toBe(199)
      } finally {
        await destroy()
      }
    })
  })

  describe('assertArchiveTableFilesReadable', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'production-archive-db-test-')
      )
      await fs.mkdir(path.join(tempDir, 'database'))
    })

    afterEach(async () => {
      await fs.rm(tempDir, { force: true, recursive: true })
    })

    it('fails before restore when an archived table payload is missing', async () => {
      await fs.writeFile(path.join(tempDir, 'database', 'users.jsonl'), '{}\n')

      await expect(
        assertArchiveTableFilesReadable(tempDir, [
          { name: 'users', rowCount: 1 },
          { name: 'statuses', rowCount: 1 }
        ])
      ).rejects.toThrow('missing database payload for statuses')
    })
  })

  describe('truncateTables', () => {
    // The restore order puts `children` first, so the delete order removes
    // `parents` while a child still references it: only the foreign keys being
    // off lets that through.
    it('uses one SQLite connection while foreign keys are disabled', async () => {
      const { database, statements, destroy } = openSqliteArchiveDatabase()

      try {
        await sql`create table parents (id integer primary key)`.execute(
          database.db
        )
        await sql`
          create table children (
            id integer primary key,
            "parentId" integer references parents (id)
          )
        `.execute(database.db)
        await sql`insert into parents (id) values (1)`.execute(database.db)
        await sql`
          insert into children (id, "parentId") values (1, 1)
        `.execute(database.db)
        await expect(
          sql`PRAGMA foreign_keys`.execute(database.db)
        ).resolves.toMatchObject({ rows: [{ foreign_keys: 1 }] })
        await expect(
          sql`delete from parents`.execute(database.db)
        ).rejects.toThrow('FOREIGN KEY constraint failed')
        statements.length = 0

        await truncateTables(
          database,
          ['parents', 'children'],
          ['children', 'parents']
        )

        expect(statements.map(({ sql }) => sql.trim())[0]).toBe(
          'PRAGMA foreign_keys = OFF'
        )
        expect(statements.at(-1)?.sql).toBe('PRAGMA foreign_keys = ON')
        expect(
          new Set(statements.map(({ connection }) => connection)).size
        ).toBe(1)
        await expect(
          sql`select * from parents`.execute(database.db)
        ).resolves.toMatchObject({ rows: [] })
        await expect(
          sql`select * from children`.execute(database.db)
        ).resolves.toMatchObject({ rows: [] })
        await expect(
          sql`PRAGMA foreign_keys`.execute(database.db)
        ).resolves.toMatchObject({ rows: [{ foreign_keys: 1 }] })
      } finally {
        await destroy()
      }
    })
  })

  // Runs on SQLite by default and on PostgreSQL under TEST_DATABASE_TYPE=pg.
  // The source is a database `migrateToLatest` built from empty, seeded
  // through the app and with values of every stored representation added
  // directly; the target starts empty, so the restore runs the migrations.
  describe('export and restore round trip', () => {
    const backend = process.env.TEST_DATABASE_TYPE === 'pg' ? 'pg' : 'sqlite'
    // Running every migration twice takes a while, on PostgreSQL especially.
    const ROUND_TRIP_TIMEOUT_MS = 180_000
    const SQLITE_STORED_TIME = Date.UTC(2026, 1, 3, 4, 5, 6, 789)

    let tempDir: string
    let archiveDir: string
    let sourceConfig: DatabaseConfig
    let targetConfig: DatabaseConfig
    let manifest: ArchiveManifest
    let exportStatements: string[]

    const sqliteFileConfig = (filename: string): DatabaseConfig => ({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename }
    })

    // Every table's rows as the archive's connection reads them, each as its
    // JSON line, sorted. SQLite's full-text search tables are left out: the
    // restore rebuilds that index from search_documents instead of copying it
    // (see searchMatches).
    const dumpTables = async (config: DatabaseConfig) => {
      const { database, destroy } = openArchiveDatabase(config)
      try {
        const { rows: fullText } =
          backend === 'sqlite'
            ? await sql<{ name: string }>`
                select name from pragma_table_list
                where schema = 'main' and type in ('virtual', 'shadow')
              `.execute(database.db)
            : { rows: [] }
        const skipped = new Set(fullText.map((row) => row.name))
        const dump: Record<string, string[]> = {}
        for (const table of await getDatabaseTableNames(database)) {
          if (skipped.has(table)) continue
          const { rows } = await sql`
            select * from ${sql.id(table)}
          `.execute(database.db)
          dump[table] = rows.map((row) => JSON.stringify(row)).sort()
        }
        return dump
      } finally {
        await destroy()
      }
    }

    // The search documents a full-text search for `word` finds, after SQLite
    // checks the index against search_documents.
    const searchMatches = async (config: DatabaseConfig, word = 'actor1') => {
      const { database, destroy } = openArchiveDatabase(config)
      try {
        if (backend === 'pg') {
          const { rows } = await sql<{ id: string }>`
            select id from search_documents
            where to_tsvector('simple', "documentText")
              @@ to_tsquery('simple', ${word})
          `.execute(database.db)
          return rows.map((row) => row.id).sort()
        }
        await sql`
          insert into search_documents_fts (search_documents_fts)
          values ('integrity-check')
        `.execute(database.db)
        const { rows } = await sql<{ id: string | null }>`
          select id from search_documents_fts
          where search_documents_fts match ${word}
        `.execute(database.db)
        return rows.map((row) => String(row.id)).sort()
      } finally {
        await destroy()
      }
    }

    const restore = async (config: DatabaseConfig) => {
      const { database, destroy } = openArchiveDatabase(config)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        await restoreDatabase(database, archiveDir, manifest)
      } finally {
        logSpy.mockRestore()
        await destroy()
      }
    }

    beforeAll(async () => {
      tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'production-archive-round-trip-')
      )
      archiveDir = path.join(tempDir, 'archive')
      if (backend === 'pg') {
        const connection = getTestPgConnection()
        await recreatePgDatabase(connection, getTestPgDatabaseName())
        await recreatePgDatabase(connection, getTestPgDatabaseName(true))
        sourceConfig = getTestDatabaseConfig('pg')
        targetConfig = getTestDatabaseConfig('pg', true)
      } else {
        sourceConfig = sqliteFileConfig(path.join(tempDir, 'source.sqlite'))
        targetConfig = sqliteFileConfig(path.join(tempDir, 'target.sqlite'))
      }

      // The source: migrated from empty, then seeded through the app.
      const app = createDatabaseConnection(sourceConfig)
      try {
        await migrateToLatest({ db: app.db, config: sourceConfig })
        await seedDatabase(getSQLDatabase(app.db))
      } finally {
        await app.destroy()
      }

      // Values in each representation the archive must carry as stored.
      const { database, destroy } = openArchiveDatabase(sourceConfig)
      try {
        if (backend === 'pg') {
          await sql`
            insert into counters (id, value, "createdAt", "updatedAt")
            values
              ('round-trip:big', '9007199254740993',
               '2026-02-03T04:05:06.789Z', '2026-02-03T04:05:06.789Z'),
              ('round-trip:micro', 1, '2026-02-03T04:05:06.789123Z',
               '2026-02-03T04:05:06.789123Z')
          `.execute(database.db)
          await sql`
            insert into status_history ("statusId", data, "createdAt")
            values ('round-trip-status',
                    ${JSON.stringify({
                      text: 'line\u2028separator ✓',
                      tags: [1, 2],
                      nested: { flag: true, nothing: null }
                    })}::jsonb,
                    '2026-02-03T04:05:06.789Z')
          `.execute(database.db)
        } else {
          await sql`
            insert into counters (id, value, "createdAt", "updatedAt")
            values
              ('round-trip:big', 4102444800123, ${SQLITE_STORED_TIME},
               ${SQLITE_STORED_TIME})
          `.execute(database.db)
          await sql`
            insert into status_history ("statusId", data, "createdAt")
            values ('round-trip-status',
                    ${JSON.stringify({
                      text: 'line\u2028separator ✓',
                      tags: [1, 2],
                      nested: { flag: true, nothing: null }
                    })},
                    ${SQLITE_STORED_TIME})
          `.execute(database.db)
        }
        // Timestamps from the column default: CURRENT_TIMESTAMP text on
        // SQLite, microseconds on PostgreSQL.
        await sql`
          insert into counters (id, value) values ('round-trip:default-time', 42)
        `.execute(database.db)
        // `date` columns, which an export east of UTC used to move a day.
        const { rows: actors } = await sql<{ id: string }>`
          select id from actors order by id limit 1
        `.execute(database.db)
        await sql`
          insert into wahoo_history_imports
            (id, "actorId", "providerUserId", "fromDate", "toDate")
          values
            ('round-trip-wahoo', ${actors[0].id}, 'wahoo-user', '2026-01-02',
             '2026-03-04')
        `.execute(database.db)
        await sql`
          insert into "customEmojis"
            (id, shortcode, url, "staticUrl", "visibleInPicker", disabled,
             "createdAt", "updatedAt")
          values
            ('round-trip-emoji', 'round_trip', 'https://llun.test/e.png',
             'https://llun.test/e.png', ${false}, ${true},
             ${new Date(SQLITE_STORED_TIME)}, ${new Date(SQLITE_STORED_TIME)})
        `.execute(database.db)
      } finally {
        await destroy()
      }

      // The export, and the statements it sent. It runs east of UTC, where a
      // `date` read as a local-midnight `Date` would be written as the
      // previous day.
      const archive = createDatabaseConnection(sourceConfig, {
        normalizeResults: false
      })
      const statements: string[] = []
      archive.onQuery(({ sql }) => {
        statements.push(sql)
      })
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        const result = await withTimeZone('Asia/Bangkok', () =>
          exportDatabase({ config: sourceConfig, db: archive.db }, archiveDir, {
            includeReferencedStoragePaths: true
          })
        )
        manifest = {
          createdAt: new Date().toISOString(),
          database: result.manifest,
          source: { host: 'llun.test', nodeEnv: 'test' },
          storage: [],
          storageScope: 'referenced',
          version: 2
        }
      } finally {
        logSpy.mockRestore()
        await archive.destroy()
      }
      exportStatements = statements
    }, ROUND_TRIP_TIMEOUT_MS)

    afterAll(async () => {
      await fs.rm(tempDir, { force: true, recursive: true })
    })

    it('exports in one read-only repeatable-read snapshot', () => {
      expect(exportStatements[0]).toBe(
        backend === 'pg'
          ? 'start transaction isolation level repeatable read read only'
          : 'begin'
      )
      expect(exportStatements.at(-1)).toBe('commit')
      expect(
        exportStatements.filter(
          (statement) => statement === 'begin' || statement === 'commit'
        )
      ).toHaveLength(backend === 'pg' ? 1 : 2)
    })

    it('records the migrations the source applied', async () => {
      expect(manifest.database?.client).toBe(
        backend === 'pg' ? 'pg' : 'better-sqlite3'
      )
      expect(manifest.database?.migrations).toEqual(
        await getKnownMigrationNames()
      )
      expect(
        manifest.database?.tables.find((table) => table.name === 'actors')
          ?.rowCount
      ).toBeGreaterThan(0)
    })

    it('writes dates and timestamps as the database holds them', async () => {
      const readTable = async (table: string) =>
        Array.fromAsync(
          readJsonLines(path.join(archiveDir, 'database', `${table}.jsonl`))
        )
      expect(
        (await readTable('wahoo_history_imports')).map(
          ({ fromDate, toDate }) => ({ fromDate, toDate })
        )
      ).toEqual([{ fromDate: '2026-01-02', toDate: '2026-03-04' }])

      const counters = new Map(
        (await readTable('counters')).map((row) => [row.id, row.createdAt])
      )
      if (backend === 'pg') {
        // The server's text, in its zone, with the microseconds.
        expect(counters.get('round-trip:micro')).toMatch(
          /^2026-02-0[34] \d\d:\d\d:06\.789123[+-]\d\d(:\d\d)?$/
        )
      } else {
        expect(counters.get('round-trip:big')).toBe(SQLITE_STORED_TIME)
        expect(counters.get('round-trip:default-time')).toMatch(
          /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/
        )
      }
    })

    it(
      'restores into an empty database, running the migrations first',
      async () => {
        const target = createDatabaseConnection(targetConfig)
        try {
          expect(
            await getAppliedMigrationNames({
              db: target.db,
              config: targetConfig
            })
          ).toEqual([])
        } finally {
          await target.destroy()
        }

        await restore(targetConfig)

        const source = await dumpTables(sourceConfig)
        const restored = await dumpTables(targetConfig)
        expect(Object.keys(restored)).toEqual(Object.keys(source))
        expect(restored).toEqual(source)
        expect(source.actors.length).toBeGreaterThan(0)
        expect(source.statuses.length).toBeGreaterThan(0)
        expect(source.search_documents.length).toBeGreaterThan(0)

        // A search on the restored database finds the restored documents.
        const sourceMatches = await searchMatches(sourceConfig)
        expect(sourceMatches.length).toBeGreaterThan(0)
        expect(await searchMatches(targetConfig)).toEqual(sourceMatches)
      },
      ROUND_TRIP_TIMEOUT_MS
    )

    it('keeps every value as it was stored', async () => {
      const { database, destroy } = openArchiveDatabase(targetConfig)
      try {
        // On PostgreSQL each timestamp also in UTC, to compare it exactly
        // whatever the server's zone.
        const utc = (column: string) =>
          backend === 'pg'
            ? sql`, (${sql.ref(column)} at time zone 'UTC')::text as "utc"`
            : sql``
        const { rows: counters } = await sql<Record<string, unknown>>`
          select id, value, "createdAt" ${utc('createdAt')} from counters
          where id like 'round-trip:%' order by id
        `.execute(database.db)
        const { rows: emojis } = await sql<Record<string, unknown>>`
          select disabled, "visibleInPicker", "createdAt" ${utc('createdAt')}
          from "customEmojis" where id = 'round-trip-emoji'
        `.execute(database.db)
        const { rows: history } = await sql<Record<string, unknown>>`
          select data, "createdAt" ${utc('createdAt')} from status_history
          where "statusId" = 'round-trip-status'
        `.execute(database.db)
        const { rows: imports } = await sql<Record<string, unknown>>`
          select "fromDate", "toDate" from wahoo_history_imports
          where id = 'round-trip-wahoo'
        `.execute(database.db)
        expect(imports).toEqual([
          { fromDate: '2026-01-02', toDate: '2026-03-04' }
        ])
        const data = {
          text: 'line\u2028separator ✓',
          tags: [1, 2],
          nested: { flag: true, nothing: null }
        }

        if (backend === 'pg') {
          // node-postgres's own types (int8 as an exact string, jsonb
          // parsed), with timestamps as the server's text, microseconds
          // included.
          const stored = '2026-02-03 04:05:06.789'
          expect(counters).toEqual([
            {
              id: 'round-trip:big',
              value: '9007199254740993',
              createdAt: expect.any(String),
              utc: stored
            },
            {
              id: 'round-trip:default-time',
              value: '42',
              createdAt: expect.any(String),
              utc: expect.stringMatching(
                /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?$/
              )
            },
            {
              id: 'round-trip:micro',
              value: '1',
              createdAt: expect.any(String),
              utc: '2026-02-03 04:05:06.789123'
            }
          ])
          expect(emojis).toEqual([
            {
              disabled: true,
              visibleInPicker: false,
              createdAt: expect.any(String),
              utc: stored
            }
          ])
          expect(history).toEqual([
            { data, createdAt: expect.any(String), utc: stored }
          ])
        } else {
          // SQLite's stored values: epoch ms and the column default's
          // CURRENT_TIMESTAMP text side by side, 0/1, JSON text.
          expect(counters).toEqual([
            {
              id: 'round-trip:big',
              value: 4102444800123,
              createdAt: SQLITE_STORED_TIME
            },
            {
              id: 'round-trip:default-time',
              value: 42,
              createdAt: expect.stringMatching(
                /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/
              )
            }
          ])
          expect(emojis).toEqual([
            {
              disabled: 1,
              visibleInPicker: 0,
              createdAt: SQLITE_STORED_TIME
            }
          ])
          expect(history).toEqual([
            { data: JSON.stringify(data), createdAt: SQLITE_STORED_TIME }
          ])
        }
      } finally {
        await destroy()
      }
    })

    it(
      'replaces the data of a database that is already migrated',
      async () => {
        const { database, destroy } = openArchiveDatabase(targetConfig)
        try {
          await sql`
            insert into counters (id, value) values ('only-local', 1)
          `.execute(database.db)
          await sql`
            update counters set value = 7 where id = 'round-trip:default-time'
          `.execute(database.db)
          if (backend === 'sqlite') {
            // An index entry with no search document behind it (a drifted
            // index), which only rebuilding the index removes.
            await sql`
              insert into search_documents_fts (rowid, id, "documentText")
              values (999999999, 'drifted', 'driftword')
            `.execute(database.db)
          }
        } finally {
          await destroy()
        }

        await restore(targetConfig)

        expect(await dumpTables(targetConfig)).toEqual(
          await dumpTables(sourceConfig)
        )
        expect(await searchMatches(targetConfig)).toEqual(
          await searchMatches(sourceConfig)
        )
        expect(await searchMatches(targetConfig, 'driftword')).toEqual([])

        if (backend === 'pg') {
          // Serial columns continue after the restored rows.
          const { database: restored, destroy: close } =
            openArchiveDatabase(targetConfig)
          try {
            const { rows: maximum } = await sql<{ id: number }>`
              select max(id) as id from status_history
            `.execute(restored.db)
            const { rows: inserted } = await sql<{ id: number }>`
              insert into status_history ("statusId", data)
              values ('after-restore', '{}'::jsonb) returning id
            `.execute(restored.db)
            expect(inserted[0].id).toBe(maximum[0].id + 1)
          } finally {
            await close()
          }
        }
      },
      ROUND_TRIP_TIMEOUT_MS
    )

    it('refuses an archive whose migrations this checkout does not have', async () => {
      const { database, destroy } = openArchiveDatabase(targetConfig)
      try {
        await expect(
          restoreDatabase(database, archiveDir, {
            ...manifest,
            database: {
              ...manifest.database!,
              migrations: [
                ...manifest.database!.migrations,
                '29990101000000_from_the_future.js'
              ]
            }
          })
        ).rejects.toThrow(
          'Missing locally: 29990101000000_from_the_future.js. ' +
            'Extra locally: none.'
        )
      } finally {
        await destroy()
      }
    })

    // Only an external-content FTS5 table can be rebuilt from the table it
    // indexes; a contentless one holds what the restore would have to write.
    it.runIf(backend === 'sqlite')(
      'refuses a SQLite virtual table it could not rebuild',
      async () => {
        const otherArchiveDir = path.join(tempDir, 'contentless-archive')
        await fs.mkdir(path.join(otherArchiveDir, 'database'), {
          recursive: true
        })
        await fs.writeFile(
          path.join(otherArchiveDir, 'database', 'notes_fts.jsonl'),
          ''
        )
        const { database, destroy } = openArchiveDatabase(targetConfig)
        try {
          await sql`
            create virtual table notes_fts using fts5(body, content='')
          `.execute(database.db)
          await expect(
            restoreDatabase(database, otherArchiveDir, {
              ...manifest,
              database: {
                ...manifest.database!,
                tables: [{ name: 'notes_fts', rowCount: 0 }]
              }
            })
          ).rejects.toThrow(
            'Cannot restore SQLite virtual or shadow table(s) notes_fts'
          )
          // Nothing was deleted.
          const { rows } = await sql<{ count: number }>`
            select count(*) as count from actors
          `.execute(database.db)
          expect(rows[0].count).toBeGreaterThan(0)
        } finally {
          await sql`drop table if exists notes_fts`.execute(database.db)
          await destroy()
        }
      }
    )
  })
})
