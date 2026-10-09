import fs from 'fs/promises'
import knex from 'knex'
import os from 'os'
import path from 'path'

import {
  assertArchiveTableFilesReadable,
  assertMatchingMigrations,
  exportDatabase,
  getDatabaseTableNames,
  getRestoreInsertBatchSize,
  readJsonLines,
  sortTablesForRestore,
  stringifyJsonColumnValues,
  truncateTables
} from './productionArchive'

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
      const database = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true
      })
      const statements: string[] = []
      database.on('query', (query) => {
        statements.push(query.sql)
      })
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        await database.schema.createTable('events', (table) => {
          table.string('name')
        })
        await database.batchInsert(
          'events',
          Array.from({ length: 1005 }, (_, index) => ({
            name: `event-${index}`
          })),
          200
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

        const tableExportStatements = statements.filter((statement) => {
          return statement.includes('from `events`')
        })
        expect(
          tableExportStatements.every((statement) => {
            return !statement.toLowerCase().includes('offset')
          })
        ).toBe(true)
        expect(
          tableExportStatements.some((statement) => {
            return (
              statement.includes('`rowid` as') &&
              statement.includes('`rowid` > ?')
            )
          })
        ).toBe(true)
      } finally {
        logSpy.mockRestore()
        await database.destroy()
      }
    })

    it('uses an unshadowed SQLite rowid cursor for no-primary-key tables', async () => {
      const database = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true
      })
      const statements: string[] = []
      database.on('query', (query) => {
        statements.push(query.sql)
      })
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        await database.schema.createTable('events', (table) => {
          table.string('rowid')
          table.string('name')
        })
        await database.batchInsert(
          'events',
          Array.from({ length: 1005 }, (_, index) => ({
            name: `event-${index}`,
            rowid: 'duplicate-user-value'
          })),
          200
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
          statements.some((statement) => {
            return (
              statement.includes('`_rowid_` as') &&
              statement.includes('`_rowid_` > ?')
            )
          })
        ).toBe(true)
      } finally {
        logSpy.mockRestore()
        await database.destroy()
      }
    })

    it('treats SQLite rowid cursor shadowing as case-insensitive', async () => {
      const database = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true
      })
      const statements: string[] = []
      database.on('query', (query) => {
        statements.push(query.sql)
      })
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        await database.schema.createTable('events', (table) => {
          table.string('ROWID')
          table.string('name')
        })
        await database.batchInsert(
          'events',
          Array.from({ length: 1005 }, (_, index) => ({
            name: `event-${index}`,
            ROWID: 'duplicate-user-value'
          })),
          200
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
          statements.some((statement) => {
            return (
              statement.includes('`_rowid_` as') &&
              statement.includes('`_rowid_` > ?')
            )
          })
        ).toBe(true)
      } finally {
        logSpy.mockRestore()
        await database.destroy()
      }
    })

    it('uses a non-colliding private cursor alias for SQLite rowid export', async () => {
      const database = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true
      })
      const statements: string[] = []
      database.on('query', (query) => {
        statements.push(query.sql)
      })
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        await database.schema.createTable('events', (table) => {
          table.string('__activitynext_archive_cursor')
          table.string('__ACTIVITYNEXT_ARCHIVE_CURSOR_1')
          table.string('name')
        })
        await database.batchInsert(
          'events',
          Array.from({ length: 1005 }, (_, index) => ({
            __ACTIVITYNEXT_ARCHIVE_CURSOR_1: `upper-real-${index}`,
            __activitynext_archive_cursor: `real-${index}`,
            name: `event-${index}`
          })),
          200
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
          statements.some((statement) => {
            return statement.includes('as `__activitynext_archive_cursor_2`')
          })
        ).toBe(true)
      } finally {
        logSpy.mockRestore()
        await database.destroy()
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
      const database = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true
      })

      try {
        await database.schema.createTable('app_data', (table) => {
          table.integer('id').primary()
        })
        await database.schema.createTable('knex_migrations_lock', (table) => {
          table.integer('index').primary()
          table.integer('is_locked')
        })

        await database('app_data').insert({ id: 1 })

        await expect(getDatabaseTableNames(database)).resolves.toEqual([
          'app_data'
        ])
      } finally {
        await database.destroy()
      }
    })
  })

  describe('getRestoreInsertBatchSize', () => {
    it('uses a conservative SQLite batch size based on column count', async () => {
      const database = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true
      })

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
        await database.destroy()
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
    it('uses one SQLite connection while foreign keys are disabled', async () => {
      const database = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true
      })

      try {
        await database.schema.createTable('parents', (table) => {
          table.integer('id').primary()
        })
        await database.schema.createTable('children', (table) => {
          table.integer('id').primary()
          table.integer('parentId').references('parents.id')
        })
        await database('parents').insert({ id: 1 })
        await database('children').insert({ id: 1, parentId: 1 })

        await truncateTables(
          database,
          ['parents', 'children'],
          ['children', 'parents']
        )

        await expect(database('parents')).resolves.toEqual([])
        await expect(database('children')).resolves.toEqual([])
      } finally {
        await database.destroy()
      }
    })
  })
})
