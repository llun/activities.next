import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import {
  isLocalDatabaseConfig,
  isLocalDatabaseConnection,
  parseDownloadArgs,
  parseEnvFile,
  parseRestoreArgs
} from './productionArchive'

describe('production archive scripts', () => {
  describe('parseDownloadArgs', () => {
    it('uses production-safe defaults', () => {
      expect(parseDownloadArgs([])).toEqual({
        allowMissingStorage: false,
        envFile: '.env.production',
        outputDir: 'backups/production-archives',
        skipDatabase: false,
        skipStorage: false,
        storageScope: 'referenced'
      })
    })

    it('accepts explicit output and all-storage mode', () => {
      expect(
        parseDownloadArgs([
          '--env-file',
          '.env.prod.snapshot',
          '--output-dir=tmp/archive',
          '--storage-scope',
          'all',
          '--allow-missing-storage',
          '--skip-storage'
        ])
      ).toEqual({
        allowMissingStorage: true,
        envFile: '.env.prod.snapshot',
        outputDir: 'tmp/archive',
        skipDatabase: false,
        skipStorage: true,
        storageScope: 'all'
      })
    })
  })

  describe('parseRestoreArgs', () => {
    it('requires an archive and an explicit confirmation', () => {
      expect(() => parseRestoreArgs(['--archive', 'backup.tar.gz'])).toThrow(
        'Restoring replaces local data. Pass --yes to continue.'
      )
    })

    it('accepts a local restore target', () => {
      expect(
        parseRestoreArgs([
          '--archive',
          'backup.tar.gz',
          '--env-file',
          '.env.local',
          '--yes',
          '--preserve-files'
        ])
      ).toEqual({
        allowNonLocalDatabase: false,
        archive: 'backup.tar.gz',
        databaseOnly: false,
        envFile: '.env.local',
        filesOnly: false,
        preserveFiles: true,
        safeStorageRoot: '.',
        yes: true
      })
    })
  })

  describe('parseEnvFile', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'production-archive-env-test-')
      )
    })

    afterEach(async () => {
      await fs.rm(tempDir, { force: true, recursive: true })
    })

    it('parses multiline and quoted dotenv values', async () => {
      const envPath = path.join(tempDir, '.env.production')
      await fs.writeFile(
        envPath,
        [
          'export SIMPLE=value # comment',
          'MULTILINE="line one',
          'line two"',
          'ESCAPED_NEWLINE="line one\\nline two"',
          "SINGLE='literal # hash'"
        ].join('\n')
      )

      expect(parseEnvFile(envPath)).toEqual({
        ESCAPED_NEWLINE: 'line one\nline two',
        MULTILINE: 'line one\nline two',
        SIMPLE: 'value',
        SINGLE: 'literal # hash'
      })
    })
  })

  describe('isLocalDatabaseConnection', () => {
    type Connection = Parameters<typeof isLocalDatabaseConnection>[0]

    it.each<Connection>([
      'localhost',
      '127.0.0.1',
      '::1',
      '[::1]',
      '/var/run/postgresql',
      { host: 'localhost' },
      { host: '127.0.0.1' },
      { host: '::1' },
      { host: '/var/run/postgresql' },
      'postgresql:///activity?host=/var/run',
      'postgresql:///activity?host=localhost',
      'postgresql:///activity?host=/var/run&host=localhost',
      'postgresql:///activity?host=/var/run,localhost',
      'postgresql:///activity?host=localhost&hostaddr=127.0.0.1',
      'postgresql://localhost/activity?hostaddr=127.0.0.1',
      'postgresql://%2Fvar%2Frun%2Fpostgresql/activity',
      'postgresql://%2Fvar%2Frun%2Fpostgresql,localhost/activity'
    ])('allows %j as a localhost, loopback, or socket host', (connection) => {
      expect(isLocalDatabaseConnection(connection)).toBe(true)
    })

    it.each<Connection>([
      { host: 'prod-db.example.com' },
      { host: 'postgres' },
      'prod-db.example.com',
      'postgresql://postgres/activity',
      'postgresql:///activity',
      'postgresql:///activity?host=prod-db.example.com',
      'postgresql://localhost/activity?host=prod-db.example.com',
      'postgresql:///activity?host=',
      'postgresql:///activity?host=/var/run&host=prod-db.example.com',
      'postgresql:///activity?host=/var/run,prod-db.example.com',
      'postgresql://%2Fvar%2Frun%2Fpostgresql,prod-db.example.com/activity',
      'postgresql://%2Fvar%2Frun%2Fpostgresql%2Cprod-db.example.com/activity',
      'postgresql:///activity?host=localhost&hostaddr=203.0.113.10',
      'postgresql://prod-db.example.com/activity?hostaddr=127.0.0.1',
      { host: '/var/run/postgresql,prod-db.example.com' }
    ])('rejects %j as a remote database host', (connection) => {
      expect(isLocalDatabaseConnection(connection)).toBe(false)
    })

    it('fails closed for missing or empty connection hosts', () => {
      expect(isLocalDatabaseConnection(null)).toBe(false)
      expect(isLocalDatabaseConnection(undefined)).toBe(false)
      expect(isLocalDatabaseConnection({})).toBe(false)
      expect(isLocalDatabaseConnection({ host: '' })).toBe(false)
      expect(isLocalDatabaseConnection({ host: '   ' })).toBe(false)
    })
  })

  describe('isLocalDatabaseConfig', () => {
    it('allows sqlite database files and local network database hosts', () => {
      expect(
        isLocalDatabaseConfig({
          client: 'better-sqlite3',
          connection: { filename: './dev.sqlite3' }
        })
      ).toBe(true)
      expect(
        isLocalDatabaseConfig({
          client: 'pg',
          connection: { host: 'localhost' }
        })
      ).toBe(true)
      expect(
        isLocalDatabaseConfig({
          client: 'pg',
          connection: { host: '/var/run/postgresql' }
        })
      ).toBe(true)
      expect(
        isLocalDatabaseConfig({
          client: 'pg',
          connection: 'postgresql:///activity?host=/var/run/postgresql'
        })
      ).toBe(true)
      expect(
        isLocalDatabaseConfig({
          client: 'pg',
          connection: 'postgresql://%2Fvar%2Frun%2Fpostgresql/activity'
        })
      ).toBe(true)
      expect(
        isLocalDatabaseConfig({
          client: 'mysql2',
          connection: { socketPath: '/tmp/mysql.sock' }
        })
      ).toBe(true)
    })

    it('rejects database configs without explicit local targets', () => {
      expect(
        isLocalDatabaseConfig({
          client: 'pg',
          connection: {}
        })
      ).toBe(false)
      expect(
        isLocalDatabaseConfig({
          client: 'pg',
          connection: { host: 'prod-db.example.com' }
        })
      ).toBe(false)
      expect(
        isLocalDatabaseConfig({
          client: 'pg',
          connection: { filename: './dev.sqlite3' }
        })
      ).toBe(false)
      expect(
        isLocalDatabaseConfig({
          client: 'pg',
          connection: 'postgresql:///activity'
        })
      ).toBe(false)
      expect(
        isLocalDatabaseConfig({
          client: 'pg',
          connection: { socketPath: '/tmp/mysql.sock' }
        })
      ).toBe(false)
    })
  })
})
