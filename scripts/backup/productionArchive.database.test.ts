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
  BASELINE_MIGRATION,
  getAppliedMigrationNames,
  getKnownMigrationNames,
  migrateToLatest
} from '@/lib/database/migrate'
import { tableExists } from '@/lib/database/migrate/baseline'
import { LEGACY_KNEX_MIGRATIONS } from '@/lib/database/migrate/legacyKnexMigrations'
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
  getFts5Arguments,
  getFts5ContentTable,
  getRestoreInsertBatchSize,
  openArchiveDatabase,
  readJsonLines,
  restoreDatabase,
  sortTablesForRestore,
  stringifyJsonColumnValues,
  truncateTables
} from './productionArchive'

// Every `migrateToLatest` call, with how the connection it was given reads a
// timestamp column: a normalising connection as epoch milliseconds (a number),
// the archive's own as stored text (a string). The restore must migrate on a
// normalising connection (lib/database/migrate).
const migrationCalls = vi.hoisted(() => [] as { readsTimestampAs: string }[])
vi.mock('@/lib/database/migrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/database/migrate')>()
  const { sql: probeSql } = await import('kysely')
  return {
    ...actual,
    migrateToLatest: async (
      target: Parameters<typeof actual.migrateToLatest>[0]
    ) => {
      const at = await target.db.connection().execute(async (connection) => {
        await probeSql`
          create temp table migration_probe (at timestamp)
        `.execute(connection)
        try {
          await probeSql`
            insert into migration_probe (at) values ('2026-01-02 03:04:05')
          `.execute(connection)
          const { rows } = await probeSql<{ at: unknown }>`
            select at from migration_probe
          `.execute(connection)
          return rows[0].at
        } finally {
          await probeSql`drop table migration_probe`.execute(connection)
        }
      })
      migrationCalls.push({ readsTimestampAs: typeof at })
      return actual.migrateToLatest(target)
    }
  }
})

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

// Inserts `rows` in batches of 200.
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

  // The FTS5 declarations below are all accepted by SQLite, which reads their
  // content table (or none) the same way.
  describe('getFts5ContentTable', () => {
    const create = (args: string) =>
      `CREATE VIRTUAL TABLE notes_fts USING fts5(${args})`

    it.each([
      // The migration's own declaration (search_documents_fts).
      [
        "id UNINDEXED, documentText, content='search_documents', content_rowid='rowid'",
        'search_documents'
      ],
      ['body, content=docs', 'docs'],
      ['body, content="docs"', 'docs'],
      ['body, content=[docs]', 'docs'],
      ['body, content=`docs`', 'docs'],
      ["body, content = 'it''s'", "it's"],
      ['body, content="a""b"', 'a"b'],
      ['body, content=[a b]', 'a b'],
      // Option names in any case; the table name as written.
      ['body, CONTENT=Docs', 'Docs'],
      ["body, Content = 'Docs'", 'Docs'],
      // Any prefix of the option name, as FTS5 reads it.
      ['body, c=docs', 'docs'],
      ['body, cont=docs', 'docs'],
      ["body, CONTE='Docs'", 'Docs'],
      ['body, Con = [docs]', 'docs'],
      // Contentless.
      ["body, content=''", ''],
      ['body, content=""', ''],
      // Self-contained: no content option, or `content=` only inside another
      // argument's quoted value or a comment.
      ['body', null],
      ["body, content_rowid='rowid'", null],
      // A prefix of content_rowid that is not one of content.
      ['body, content_r=x', null],
      [`body, tokenize = "unicode61 separators ', content=x'"`, null],
      ['body, "x, content=y"', null],
      ['body, [x, content=y]', null],
      ['body /* , content=x */', null],
      ['body -- , content=x\n', null],
      [`body, tokenize="unicode61 separators ',='", content=[docs]`, 'docs']
    ])('reads %j as %j', (args, expected) => {
      expect(getFts5ContentTable(create(args))).toBe(expected)
    })

    it('matches fts5 in any case and ignores other modules', () => {
      expect(
        getFts5ContentTable(
          'create virtual table notes_fts using FTS5 (body, content=docs)'
        )
      ).toBe('docs')
      expect(
        getFts5ContentTable(
          'create virtual table notes_fts using fts4(body, content=docs)'
        )
      ).toBeNull()
      expect(
        getFts5ContentTable(
          'create virtual table boxes using rtree(id, minX, maxX)'
        )
      ).toBeNull()
    })

    it('splits arguments only outside quotes, brackets and parentheses', () => {
      expect(
        getFts5Arguments(
          create(
            `body, tokenize = "porter unicode61 separators ',)'", ` +
              `prefix='2 3', content=[x, y]`
          )
        )
      ).toEqual([
        'body',
        `tokenize = "porter unicode61 separators ',)'"`,
        "prefix='2 3'",
        'content=[x, y]'
      ])
      expect(getFts5Arguments(create('body, content=docs').slice(0, -1))).toBe(
        null
      )
    })
  })

  describe('getDatabaseTableNames', () => {
    it('excludes SQLite internal tables and the migration bookkeeping', async () => {
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
        await sql`
          create table knex_migrations (
            id integer primary key autoincrement,
            name varchar(255)
          )
        `.execute(database.db)
        await sql`
          create table kysely_migration (name varchar(255) primary key)
        `.execute(database.db)
        await sql`
          create table kysely_migration_lock (id varchar(255) primary key)
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

    const restore = async (config: DatabaseConfig, fromDir = archiveDir) => {
      const { database, destroy } = openArchiveDatabase(config)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        await restoreDatabase(database, fromDir, manifest)
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

      if (backend === 'pg') {
        // A server whose sessions default to another zone and date style,
        // which the archive's connection replaces with ISO and UTC. Set
        // after seeding: the app's normalising connection, like
        // node-postgres's parsers, expects the ISO style.
        const admin = createDatabaseConnection(sourceConfig)
        try {
          await sql`
            alter database ${sql.id(getTestPgDatabaseName())}
            set "TimeZone" to 'Asia/Kolkata'
          `.execute(admin.db)
          await sql`
            alter database ${sql.id(getTestPgDatabaseName())}
            set "DateStyle" to 'SQL, DMY'
          `.execute(admin.db)
        } finally {
          await admin.destroy()
        }
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
      if (backend === 'pg') {
        // The next file in this worker may use the database without
        // recreating it.
        const admin = createDatabaseConnection(sourceConfig)
        try {
          await sql`
            alter database ${sql.id(getTestPgDatabaseName())} reset all
          `.execute(admin.db)
        } finally {
          await admin.destroy()
        }
      }
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
      expect(manifest.database?.migrations).toEqual([BASELINE_MIGRATION])
      // The migration bookkeeping is not archived: the manifest's list says
      // what the source had applied.
      expect(
        manifest.database?.tables
          .map((table) => table.name)
          .filter((name) => /migration/.test(name))
      ).toEqual([])
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
        // The source's sessions default to Asia/Kolkata and the SQL style
        // (`03/02/2026 09:35:06.789123 IST`), but the archive holds ISO text
        // in UTC, with the microseconds.
        const other = createDatabaseConnection(sourceConfig)
        try {
          const { rows } = await sql<{ zone: string; style: string }>`
            select current_setting('TimeZone') as zone,
                   current_setting('DateStyle') as style
          `.execute(other.db)
          expect(rows).toEqual([{ zone: 'Asia/Kolkata', style: 'SQL, DMY' }])
        } finally {
          await other.destroy()
        }
        expect(counters.get('round-trip:micro')).toBe(
          '2026-02-03 04:05:06.789123+00'
        )
        expect(counters.get('round-trip:big')).toBe(
          '2026-02-03 04:05:06.789+00'
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

        const migrationsBefore = migrationCalls.length
        await restore(targetConfig)
        // The restore migrated once, on a connection that normalises results.
        expect(migrationCalls.slice(migrationsBefore)).toEqual([
          { readsTimestampAs: 'number' }
        ])

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

    // An archive written before its connection set UTC holds each timestamp
    // in its server's zone; the offset says which instant it is.
    it.runIf(backend === 'pg')(
      'restores a timestamp written with another offset as the same instant',
      async () => {
        const offsetArchiveDir = path.join(tempDir, 'offset-archive')
        await fs.cp(archiveDir, offsetArchiveDir, { recursive: true })
        const countersFile = path.join(
          offsetArchiveDir,
          'database',
          'counters.jsonl'
        )
        const lines = (await fs.readFile(countersFile, 'utf8'))
          .split('\n')
          .filter((line) => line.length > 0)
        let rewritten = 0
        await fs.writeFile(
          countersFile,
          lines
            .map((line) => {
              const row = JSON.parse(line)
              if (row.id !== 'round-trip:micro') return line
              rewritten += 1
              return JSON.stringify({
                ...row,
                createdAt: '2026-02-03 09:35:06.789123+05:30',
                updatedAt: '2026-02-03 09:35:06.789123+05:30'
              })
            })
            .join('\n') + '\n'
        )
        expect(rewritten).toBe(1)

        await restore(targetConfig, offsetArchiveDir)

        const { database, destroy } = openArchiveDatabase(targetConfig)
        try {
          const { rows } = await sql<Record<string, unknown>>`
            select "createdAt", "updatedAt",
                   ("createdAt" at time zone 'UTC')::text as "utc"
            from counters where id = 'round-trip:micro'
          `.execute(database.db)
          expect(rows).toEqual([
            {
              createdAt: '2026-02-03 04:05:06.789123+00',
              updatedAt: '2026-02-03 04:05:06.789123+00',
              utc: '2026-02-03 04:05:06.789123'
            }
          ])
        } finally {
          await destroy()
        }
      },
      ROUND_TRIP_TIMEOUT_MS
    )

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
    // The archive also holds an ordinary table, which a refusal that came
    // after the deletes would have emptied.
    it.runIf(backend === 'sqlite')(
      'refuses a SQLite virtual table it could not rebuild, before deleting anything',
      async () => {
        const otherArchiveDir = path.join(tempDir, 'contentless-archive')
        await fs.mkdir(path.join(otherArchiveDir, 'database'), {
          recursive: true
        })
        await fs.writeFile(
          path.join(otherArchiveDir, 'database', 'notes.jsonl'),
          `${JSON.stringify({ id: 2, body: 'restored' })}\n`
        )
        await fs.writeFile(
          path.join(otherArchiveDir, 'database', 'notes_fts.jsonl'),
          ''
        )
        // The target is migrated whether or not the tests before this one
        // ran, so the refusal is the only thing the restore can stop at.
        const app = createDatabaseConnection(targetConfig)
        try {
          await migrateToLatest({ db: app.db, config: targetConfig })
        } finally {
          await app.destroy()
        }
        const { database, destroy } = openArchiveDatabase(targetConfig)
        try {
          await sql`
            create table notes (id integer primary key, body text)
          `.execute(database.db)
          await sql`
            insert into notes (id, body) values (1, 'kept')
          `.execute(database.db)
          await sql`
            create virtual table notes_fts using fts5(body, content='')
          `.execute(database.db)
          const before = await dumpTables(targetConfig)
          expect(before.notes).toEqual([
            JSON.stringify({ id: 1, body: 'kept' })
          ])

          await expect(
            restoreDatabase(database, otherArchiveDir, {
              ...manifest,
              database: {
                ...manifest.database!,
                tables: [
                  { name: 'notes', rowCount: 1 },
                  { name: 'notes_fts', rowCount: 0 }
                ]
              }
            })
          ).rejects.toThrow(
            'Cannot restore SQLite virtual or shadow table(s) notes_fts'
          )

          // Nothing was deleted: neither the archived ordinary table nor any
          // other table of the target.
          const { rows } = await sql`
            select id, body from notes
          `.execute(database.db)
          expect(rows).toEqual([{ id: 1, body: 'kept' }])
          expect(await dumpTables(targetConfig)).toEqual(before)
        } finally {
          await sql`drop table if exists notes_fts`.execute(database.db)
          await sql`drop table if exists notes`.execute(database.db)
          await destroy()
        }
      },
      ROUND_TRIP_TIMEOUT_MS
    )

    // FTS5 reads `content=` with any quoting, and SQLite matches table names
    // in any case; the restore rebuilds such an index too. The table has no
    // triggers, so only the rebuild indexes the restored row.
    it.runIf(backend === 'sqlite')(
      'rebuilds a full-text index whose content table is quoted or in another case',
      async () => {
        const otherArchiveDir = path.join(tempDir, 'quoted-content-archive')
        await fs.mkdir(path.join(otherArchiveDir, 'database'), {
          recursive: true
        })
        await fs.writeFile(
          path.join(otherArchiveDir, 'database', 'docs.jsonl'),
          `${JSON.stringify({ id: 7, body: 'quotedword' })}\n`
        )
        await fs.writeFile(
          path.join(otherArchiveDir, 'database', 'docs_fts.jsonl'),
          ''
        )
        const app = createDatabaseConnection(targetConfig)
        try {
          await migrateToLatest({ db: app.db, config: targetConfig })
        } finally {
          await app.destroy()
        }
        const { database, destroy } = openArchiveDatabase(targetConfig)
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        try {
          await sql`
            create table docs (id integer primary key, body text)
          `.execute(database.db)
          await sql`
            create virtual table docs_fts
            using FTS5(body, CONTENT=[Docs], content_rowid=id)
          `.execute(database.db)

          await restoreDatabase(database, otherArchiveDir, {
            ...manifest,
            database: {
              ...manifest.database!,
              tables: [
                { name: 'docs', rowCount: 1 },
                { name: 'docs_fts', rowCount: 0 }
              ]
            }
          })

          expect(logSpy).toHaveBeenCalledWith(
            'Database: rebuilt docs_fts from Docs'
          )
          const { rows } = await sql<{ id: number }>`
            select rowid as id from docs_fts where docs_fts match 'quotedword'
          `.execute(database.db)
          expect(rows).toEqual([{ id: 7 }])
        } finally {
          logSpy.mockRestore()
          await sql`drop table if exists docs_fts`.execute(database.db)
          await sql`drop table if exists docs`.execute(database.db)
          await destroy()
        }
      },
      ROUND_TRIP_TIMEOUT_MS
    )

    // An empty database for one of the tests below: the target, recreated on
    // PostgreSQL; a new file on SQLite.
    const emptyTarget = async (name: string): Promise<DatabaseConfig> => {
      if (backend === 'pg') {
        await recreatePgDatabase(
          getTestPgConnection(),
          getTestPgDatabaseName(true)
        )
        return targetConfig
      }
      return sqliteFileConfig(path.join(tempDir, `${name}.sqlite`))
    }

    const restoreWith = async (
      config: DatabaseConfig,
      fromDir: string,
      fromManifest: ArchiveManifest
    ) => {
      const { database, destroy } = openArchiveDatabase(config)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        await restoreDatabase(database, fromDir, fromManifest)
        return logSpy.mock.calls.map((call) => String(call[0]))
      } finally {
        logSpy.mockRestore()
        await destroy()
      }
    }

    const knexMigrationRows = () =>
      LEGACY_KNEX_MIGRATIONS.map((name, index) => ({
        id: index + 1,
        name,
        batch: 1,
        migration_time: '2026-10-12T00:00:00.000Z'
      }))

    // What an archive made before the handover holds: the Knex migrations as
    // the manifest's list, and knex_migrations exported as a table.
    it(
      'restores an archive made before the handover into an empty database',
      async () => {
        const legacyDir = path.join(tempDir, 'legacy-archive')
        await fs.cp(archiveDir, legacyDir, { recursive: true })
        await fs.writeFile(
          path.join(legacyDir, 'database', 'knex_migrations.jsonl'),
          knexMigrationRows()
            .map((row) => `${JSON.stringify(row)}\n`)
            .join('')
        )
        const legacyManifest: ArchiveManifest = {
          ...manifest,
          database: {
            ...manifest.database!,
            migrations: [...LEGACY_KNEX_MIGRATIONS],
            tables: [
              ...manifest.database!.tables,
              {
                name: 'knex_migrations',
                rowCount: LEGACY_KNEX_MIGRATIONS.length
              }
            ].sort((a, b) => a.name.localeCompare(b.name))
          }
        }
        const config = await emptyTarget('legacy-target')

        const migrationsBefore = migrationCalls.length
        const logs = await restoreWith(config, legacyDir, legacyManifest)

        // The restore loaded the baseline once, and kept its own history.
        expect(migrationCalls.slice(migrationsBefore)).toEqual([
          { readsTimestampAs: 'number' }
        ])
        expect(logs).toContain(
          'Database: skipped knex_migrations; the local database keeps its ' +
            'own migration history'
        )
        expect(await dumpTables(config)).toEqual(await dumpTables(sourceConfig))
        expect(await searchMatches(config)).toEqual(
          await searchMatches(sourceConfig)
        )
        const restored = createDatabaseConnection(config)
        try {
          expect(
            await getAppliedMigrationNames({ db: restored.db, config })
          ).toEqual([BASELINE_MIGRATION])
          const { rows } = await sql<{ name: string }>`
            select name from kysely_migration
          `.execute(restored.db)
          expect(rows).toEqual([{ name: BASELINE_MIGRATION }])
        } finally {
          await restored.destroy()
        }
      },
      ROUND_TRIP_TIMEOUT_MS
    )

    it(
      'restores into a database the Knex migrations built, without migrating it',
      async () => {
        const config = await emptyTarget('knex-target')
        const knexDatabase = createDatabaseConnection(config)
        try {
          await knexDatabase.executeScript(
            await fs.readFile(
              path.join(
                process.cwd(),
                'migrations',
                'baseline',
                backend === 'pg' ? 'postgres.sql' : 'sqlite.sql'
              ),
              'utf8'
            )
          )
          await sql`
            create table knex_migrations (
              id integer primary key, name varchar(255), batch integer,
              migration_time varchar(64)
            )
          `.execute(knexDatabase.db)
          for (const row of knexMigrationRows()) {
            await sql`
              insert into knex_migrations (id, name, batch, migration_time)
              values (${row.id}, ${row.name}, ${row.batch},
                      ${row.migration_time})
            `.execute(knexDatabase.db)
          }
        } finally {
          await knexDatabase.destroy()
        }

        const migrationsBefore = migrationCalls.length
        await restoreWith(config, archiveDir, manifest)

        // At the baseline already: nothing ran, nothing was recorded.
        expect(migrationCalls.slice(migrationsBefore)).toEqual([])
        expect(await dumpTables(config)).toEqual(await dumpTables(sourceConfig))
        const restored = createDatabaseConnection(config)
        try {
          const { rows } = await sql<{ count: number | string }>`
            select count(*) as count from knex_migrations
          `.execute(restored.db)
          expect(Number(rows[0].count)).toBe(LEGACY_KNEX_MIGRATIONS.length)
          expect(
            await getAppliedMigrationNames({ db: restored.db, config })
          ).toEqual([BASELINE_MIGRATION])
          expect(await tableExists(restored.db, 'kysely_migration')).toBe(false)
        } finally {
          await restored.destroy()
        }
      },
      ROUND_TRIP_TIMEOUT_MS
    )
  })
})
