import fs from 'fs/promises'
import { sql } from 'kysely'
import os from 'os'
import path from 'path'

import { createDatabaseConnection } from '@/lib/database/connection'
import { BASELINE_MIGRATION } from '@/lib/database/migrate'
import { logger } from '@/lib/utils/logger'

import {
  getMigrationDatabaseConfig,
  makeMigration,
  runMigrateCommand
} from './migrate'

// The CLI behind `yarn migrate`, `yarn migrate:status`, `yarn migrate:down`
// and `yarn migrate:make`, on SQLite files (the runner itself is tested on
// both backends in lib/database/migrate/index.test.ts).

const clearDatabaseEnvironment = () => {
  for (const key of Object.keys(process.env)) {
    if (
      key === 'ACTIVITIES_DATABASE' ||
      key.startsWith('ACTIVITIES_DATABASE_') ||
      key === 'ACTIVITIES_DEFAULT_DATABASE_SQLITE_FILENAME'
    ) {
      vi.stubEnv(key, undefined)
    }
  }
}

describe('scripts/database/migrate', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-cli-test-'))
    clearDatabaseEnvironment()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await fs.rm(tempDir, { force: true, recursive: true })
  })

  describe('getMigrationDatabaseConfig', () => {
    it('falls back to ./activities.sqlite when nothing is configured', () => {
      expect(getMigrationDatabaseConfig()).toEqual({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: './activities.sqlite' }
      })
    })

    it('reads a bare SQLite file name as SQLite, without warnings', () => {
      const warn = vi.spyOn(logger, 'warn')
      vi.stubEnv('ACTIVITIES_DATABASE_SQLITE_FILENAME', '/data/app.sqlite')

      expect(getMigrationDatabaseConfig()).toEqual({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: '/data/app.sqlite' }
      })
      expect(warn).not.toHaveBeenCalled()
    })

    it('reads the PostgreSQL variables', () => {
      vi.stubEnv('ACTIVITIES_DATABASE_CLIENT', 'pg')
      vi.stubEnv('ACTIVITIES_DATABASE_PG_HOST', 'db.internal')
      vi.stubEnv('ACTIVITIES_DATABASE_PG_PORT', '5433')
      vi.stubEnv('ACTIVITIES_DATABASE_PG_USER', 'activities')
      vi.stubEnv('ACTIVITIES_DATABASE_PG_DATABASE', 'activities')

      expect(getMigrationDatabaseConfig()).toEqual({
        client: 'pg',
        connection: {
          host: 'db.internal',
          port: '5433',
          user: 'activities',
          database: 'activities'
        }
      })
    })

    it('lets the ACTIVITIES_DATABASE JSON win, and refuses one that is not JSON', () => {
      vi.stubEnv(
        'ACTIVITIES_DATABASE',
        JSON.stringify({ client: 'pg', connection: 'postgres://db/app' })
      )
      vi.stubEnv('ACTIVITIES_DATABASE_SQLITE_FILENAME', '/data/app.sqlite')
      expect(getMigrationDatabaseConfig()).toEqual({
        client: 'pg',
        connection: 'postgres://db/app'
      })

      vi.stubEnv('ACTIVITIES_DATABASE', 'activities')
      expect(() => getMigrationDatabaseConfig()).toThrow(
        'ACTIVITIES_DATABASE must be a JSON Knex configuration'
      )
    })
  })

  describe('makeMigration', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(tempDir, 'migrations'))
      await fs.copyFile(
        path.join(process.cwd(), 'migrations', 'migration.stub'),
        path.join(tempDir, 'migrations', 'migration.stub')
      )
    })

    it('writes a timestamped TypeScript migration from the stub', async () => {
      const file = await makeMigration('add_things', {
        now: new Date(Date.UTC(2026, 9, 14, 3, 4, 5)),
        cwd: tempDir
      })

      expect(file).toBe(path.join('migrations', '20261014030405_add_things.ts'))
      expect(await fs.readFile(path.join(tempDir, file), 'utf8')).toBe(
        await fs.readFile(
          path.join(process.cwd(), 'migrations', 'migration.stub'),
          'utf8'
        )
      )
      // The stub is a migration module whose steps run.
      const module = await import(path.join(tempDir, file))
      const connection = createDatabaseConnection({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename: ':memory:' }
      })
      try {
        await expect(module.up(connection.db)).resolves.toBeUndefined()
        await expect(module.down(connection.db)).resolves.toBeUndefined()
      } finally {
        await connection.destroy()
      }
    })

    it('refuses a missing or unusable name, and an existing file', async () => {
      await expect(makeMigration(undefined, { cwd: tempDir })).rejects.toThrow(
        'Usage: yarn migrate:make <name>'
      )
      await expect(
        makeMigration('../escape', { cwd: tempDir })
      ).rejects.toThrow('Usage: yarn migrate:make <name>')

      const now = new Date(Date.UTC(2026, 9, 14))
      await makeMigration('twice', { now, cwd: tempDir })
      await expect(
        makeMigration('twice', { now, cwd: tempDir })
      ).rejects.toThrow('EEXIST')
    })
  })

  describe('runMigrateCommand', () => {
    const run = async (args: string[]) => {
      const output: string[] = []
      vi.spyOn(console, 'log').mockImplementation((...line) => {
        output.push(line.join(' '))
      })
      vi.spyOn(console, 'error').mockImplementation((...line) => {
        output.push(line.join(' '))
      })
      const exitCode = await runMigrateCommand(args)
      vi.mocked(console.log).mockRestore()
      vi.mocked(console.error).mockRestore()
      return { exitCode, output: output.join('\n') }
    }

    it('prints the database, migrates, and reports the status', async () => {
      const filename = path.join(tempDir, 'cli.sqlite')
      vi.stubEnv('ACTIVITIES_DATABASE_SQLITE_FILENAME', filename)

      // Status never creates the database file.
      const before = await run(['status'])
      expect(before.exitCode).toBe(0)
      expect(before.output).toContain(
        `Database: better-sqlite3 — file ${filename}`
      )
      expect(before.output).toContain('The database file does not exist yet')
      await expect(fs.access(filename)).rejects.toThrow()

      const migrated = await run(['latest'])
      expect(migrated.exitCode).toBe(0)
      expect(migrated.output).toContain(
        `Database: better-sqlite3 — file ${filename}`
      )
      expect(migrated.output).toContain(
        `Applied 1 migration(s):\n  ${BASELINE_MIGRATION}`
      )
      expect((await run(['latest'])).output).toContain('Already up to date.')

      const status = await run(['status'])
      expect(status.exitCode).toBe(0)
      expect(status.output).toContain(
        `Handover: recorded: ${BASELINE_MIGRATION} is applied.`
      )
      expect(status.output).toMatch(
        new RegExp(`Applied \\(1\\):\\n  ${BASELINE_MIGRATION}  \\S+Z`)
      )
      expect(status.output).toContain('Pending (0):')

      vi.spyOn(console, 'log').mockImplementation(() => {})
      await expect(runMigrateCommand(['down'])).rejects.toThrow(
        `Nothing to roll back above the baseline: ${BASELINE_MIGRATION}`
      )
    })

    it('reports a database it would refuse, without writing to it', async () => {
      const filename = path.join(tempDir, 'refused.sqlite')
      vi.stubEnv('ACTIVITIES_DATABASE_SQLITE_FILENAME', filename)
      const connection = createDatabaseConnection({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename }
      })
      try {
        await sql`create table accounts (id text)`.execute(connection.db)
      } finally {
        await connection.destroy()
      }

      const status = await run(['status'])
      expect(status.exitCode).toBe(1)
      expect(status.output).toContain('Handover: REFUSED (unknown-schema)')
      expect(status.output).toContain(`Pending (1):\n  ${BASELINE_MIGRATION}`)

      const check = createDatabaseConnection({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: { filename }
      })
      try {
        const { rows } = await sql<{ name: string }>`
          select name from sqlite_master where type = 'table'
        `.execute(check.db)
        expect(rows).toEqual([{ name: 'accounts' }])
      } finally {
        await check.destroy()
      }
    })

    it('refuses an unknown command', async () => {
      const { exitCode, output } = await run(['rollback'])
      expect(exitCode).toBe(1)
      expect(output).toContain('Usage: scripts/database/migrate.ts')
    })
  })
})
