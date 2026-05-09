import { execFile } from 'child_process'
import fs from 'fs/promises'
import knex from 'knex'
import os from 'os'
import path from 'path'
import { promisify } from 'util'

import { FitnessStorageType } from '@/lib/config/fitnessStorage'
import { MediaStorageType } from '@/lib/config/mediaStorage'

import {
  PUBLIC_STORAGE_FETCH_TIMEOUT_MS,
  assertMatchingMigrations,
  assertSafeDirectoryToReplace,
  buildStoragePlan,
  createPublicStorageFetchInit,
  createS3Client,
  getReferencedStoragePaths,
  isLocalDatabaseConfig,
  isLocalDatabaseConnection,
  isSafeArchiveEntryPath,
  isSafeTarArchiveVerboseEntry,
  normalizeStorageHostname,
  parseDownloadArgs,
  parseRestoreArgs,
  sortTablesForRestore,
  truncateTables,
  validateTarArchivePaths
} from './productionArchive'

const execFileAsync = promisify(execFile)

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

  describe('isLocalDatabaseConnection', () => {
    it('allows localhost, loopback, and docker postgres hosts', () => {
      expect(isLocalDatabaseConnection({ host: 'localhost' })).toBe(true)
      expect(isLocalDatabaseConnection({ host: '127.0.0.1' })).toBe(true)
      expect(isLocalDatabaseConnection({ host: '::1' })).toBe(true)
      expect(isLocalDatabaseConnection({ host: 'postgres' })).toBe(true)
      expect(isLocalDatabaseConnection({ host: '/var/run/postgresql' })).toBe(
        true
      )
      expect(
        isLocalDatabaseConnection('postgresql:///activity?host=/var/run')
      ).toBe(true)
      expect(isLocalDatabaseConnection('postgresql:///activity')).toBe(true)
      expect(
        isLocalDatabaseConnection(
          'postgresql://%2Fvar%2Frun%2Fpostgresql/activity'
        )
      ).toBe(true)
    })

    it('rejects remote database hosts', () => {
      expect(isLocalDatabaseConnection({ host: 'prod-db.example.com' })).toBe(
        false
      )
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
          connection: 'postgresql:///activity'
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
          connection: { socketPath: '/tmp/mysql.sock' }
        })
      ).toBe(false)
    })
  })

  describe('buildStoragePlan', () => {
    it('downloads referenced media and fitness files without duplicating a shared fitness prefix', () => {
      const plan = buildStoragePlan({
        fitnessFilePaths: ['2026-01-01/activity.fit'],
        mediaFilePaths: ['medias/image.webp', 'fitness/legacy.fit'],
        scope: 'referenced',
        mediaStorage: {
          type: MediaStorageType.ObjectStorage,
          bucket: 'activitynext',
          region: 'auto'
        },
        fitnessStorage: {
          type: FitnessStorageType.ObjectStorage,
          bucket: 'activitynext',
          region: 'auto',
          prefix: 'fitness/'
        }
      })

      expect(plan).toEqual([
        {
          destination: 'media',
          files: ['medias/image.webp'],
          source: {
            bucket: 'activitynext',
            kind: 's3',
            prefix: undefined,
            region: 'auto'
          }
        },
        {
          destination: 'fitness',
          files: ['2026-01-01/activity.fit'],
          source: {
            bucket: 'activitynext',
            kind: 's3',
            prefix: 'fitness/',
            region: 'auto'
          }
        }
      ])
    })

    it('preserves object storage hostnames for S3-compatible clients', () => {
      const plan = buildStoragePlan({
        fitnessFilePaths: ['2026-01-01/activity.fit'],
        mediaFilePaths: ['medias/image.webp'],
        scope: 'referenced',
        mediaStorage: {
          type: MediaStorageType.ObjectStorage,
          bucket: 'activitynext',
          hostname: 'media-storage.example.com',
          region: 'auto'
        },
        fitnessStorage: {
          type: FitnessStorageType.ObjectStorage,
          bucket: 'activitynext',
          hostname: 'fitness-storage.example.com',
          prefix: 'fitness/',
          region: 'auto'
        }
      })

      expect(plan[0].source).toMatchObject({
        hostname: 'media-storage.example.com'
      })
      expect(plan[1].source).toMatchObject({
        hostname: 'fitness-storage.example.com'
      })
    })

    it('filters referenced media files inside a shared local fitness directory', () => {
      const plan = buildStoragePlan({
        fitnessFilePaths: ['2026-01-01/activity.fit'],
        mediaFilePaths: [
          'images/photo.webp',
          'fitness/legacy.fit',
          'fitness/maps/map.webp'
        ],
        scope: 'referenced',
        mediaStorage: {
          type: MediaStorageType.LocalFile,
          path: '/tmp/activitynext/uploads'
        },
        fitnessStorage: {
          type: FitnessStorageType.LocalFile,
          path: '/tmp/activitynext/uploads/fitness'
        }
      })

      expect(plan).toEqual([
        {
          destination: 'media',
          files: ['images/photo.webp'],
          source: {
            kind: 'local',
            path: '/tmp/activitynext/uploads'
          }
        },
        {
          destination: 'fitness',
          files: ['2026-01-01/activity.fit'],
          source: {
            kind: 'local',
            path: '/tmp/activitynext/uploads/fitness'
          }
        }
      ])
    })

    it('sets shared local fitness exclusions once for all-storage mode', () => {
      const plan = buildStoragePlan({
        fitnessFilePaths: [],
        mediaFilePaths: [],
        scope: 'all',
        mediaStorage: {
          type: MediaStorageType.LocalFile,
          path: '/tmp/activitynext/uploads'
        },
        fitnessStorage: {
          type: FitnessStorageType.LocalFile,
          path: '/tmp/activitynext/uploads/fitness'
        }
      })

      expect(plan[0]).toMatchObject({
        destination: 'media',
        excludePrefixes: ['fitness']
      })
    })
  })

  describe('getReferencedStoragePaths', () => {
    it('collects media and fitness paths with keyset pagination', async () => {
      const database = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true
      })
      const mediaCount = 1005
      const fitnessCount = 1005

      try {
        await database.schema.createTable('medias', (table) => {
          table.increments('id').primary()
          table.string('original')
          table.string('thumbnail')
        })
        await database.schema.createTable('fitness_files', (table) => {
          table.string('id').primary()
          table.string('path')
          table.string('mapImagePath')
        })

        await database.batchInsert(
          'medias',
          Array.from({ length: mediaCount }, (_, index) => ({
            original: `medias/original-${index}.webp`,
            thumbnail: index % 2 === 0 ? `medias/thumb-${index}.webp` : null
          })),
          200
        )
        await database.batchInsert(
          'fitness_files',
          Array.from({ length: fitnessCount }, (_, index) => ({
            id: `fitness-${String(index).padStart(4, '0')}`,
            mapImagePath: index % 2 === 0 ? `medias/map-${index}.webp` : null,
            path: `fitness/${index}.fit`
          })),
          200
        )

        const paths = await getReferencedStoragePaths(database)

        expect(paths.fitnessFilePaths).toHaveLength(fitnessCount)
        expect(paths.mediaFilePaths).toHaveLength(
          mediaCount + Math.ceil(mediaCount / 2) + Math.ceil(fitnessCount / 2)
        )
        expect(paths.fitnessFilePaths).toContain('fitness/1004.fit')
        expect(paths.mediaFilePaths).toContain('medias/original-1004.webp')
        expect(paths.mediaFilePaths).toContain('medias/map-1004.webp')
      } finally {
        await database.destroy()
      }
    })
  })

  describe('createS3Client', () => {
    it('uses the configured hostname as the S3-compatible endpoint', async () => {
      expect(normalizeStorageHostname('https://storage.example.com/')).toBe(
        'storage.example.com'
      )

      const client = createS3Client({
        bucket: 'bucket',
        hostname: 'https://storage.example.com/',
        kind: 's3',
        region: 'auto'
      })

      try {
        const endpoint = await client.config.endpoint!()
        expect(endpoint.hostname).toBe('storage.example.com')
        expect(endpoint.protocol).toBe('https:')
      } finally {
        client.destroy()
      }
    })
  })

  describe('createPublicStorageFetchInit', () => {
    it('sets a timeout signal for public storage downloads', () => {
      const init = createPublicStorageFetchInit()

      expect(PUBLIC_STORAGE_FETCH_TIMEOUT_MS).toBe(30_000)
      expect(init.signal).toBeInstanceOf(AbortSignal)
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

  describe('assertSafeDirectoryToReplace', () => {
    it('rejects broad filesystem and workspace paths', () => {
      expect(() => assertSafeDirectoryToReplace('')).toThrow(
        'empty directory path'
      )
      expect(() => assertSafeDirectoryToReplace('/')).toThrow(
        'unsafe directory'
      )
      expect(() => assertSafeDirectoryToReplace(os.homedir())).toThrow(
        'unsafe directory'
      )
      expect(() =>
        assertSafeDirectoryToReplace(path.join(os.homedir(), 'Documents'))
      ).toThrow('unsafe directory')
      expect(() => assertSafeDirectoryToReplace(process.cwd())).toThrow(
        'unsafe directory'
      )
      expect(() =>
        assertSafeDirectoryToReplace(
          path.join(os.homedir(), 'Documents', 'uploads')
        )
      ).toThrow('outside safe storage root')
    })

    it('allows child directories under the safe storage root', () => {
      expect(
        assertSafeDirectoryToReplace('/tmp/activitynext/uploads', '/tmp')
      ).toBe('/tmp/activitynext/uploads')
    })
  })

  describe('isSafeArchiveEntryPath', () => {
    it('accepts archive-relative paths', () => {
      expect(isSafeArchiveEntryPath('./manifest.json')).toBe(true)
      expect(isSafeArchiveEntryPath('storage/media/files/a.jpg')).toBe(true)
    })

    it('rejects archive paths that can escape the extraction directory', () => {
      expect(isSafeArchiveEntryPath('../x')).toBe(false)
      expect(isSafeArchiveEntryPath('/x')).toBe(false)
      expect(isSafeArchiveEntryPath('storage/../../x')).toBe(false)
      expect(isSafeArchiveEntryPath('..\\..\\etc\\passwd')).toBe(false)
      expect(isSafeArchiveEntryPath('storage\\..\\..\\x')).toBe(false)
      expect(isSafeArchiveEntryPath('\\absolute')).toBe(false)
    })
  })

  describe('validateTarArchivePaths', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'production-archive-test-')
      )
    })

    afterEach(async () => {
      await fs.rm(tempDir, { force: true, recursive: true })
    })

    it('rejects symlink and hardlink archive entries', async () => {
      const sourceDir = path.join(tempDir, 'source')
      await fs.mkdir(sourceDir)
      await fs.writeFile(path.join(sourceDir, 'file.txt'), 'content')
      await fs.symlink('/etc/passwd', path.join(sourceDir, 'link'))
      await fs.link(
        path.join(sourceDir, 'file.txt'),
        path.join(sourceDir, 'hardlink')
      )
      const archivePath = path.join(tempDir, 'archive.tar.gz')

      await execFileAsync('tar', ['-czf', archivePath, '-C', sourceDir, '.'])

      await expect(validateTarArchivePaths(archivePath)).rejects.toThrow(
        'unsupported entry type'
      )
    })
  })

  describe('isSafeTarArchiveVerboseEntry', () => {
    it('rejects tar symlink and hardlink listings', () => {
      expect(
        isSafeTarArchiveVerboseEntry(
          'lrwxr-xr-x  0 llun staff 0 May  9 21:02 ./link -> /etc/passwd'
        )
      ).toBe(false)
      expect(
        isSafeTarArchiveVerboseEntry(
          'hrw-r--r--  0 llun staff 0 May  9 21:02 ./hard link to ./file'
        )
      ).toBe(false)
      expect(
        isSafeTarArchiveVerboseEntry(
          '-rw-r--r--  0 llun staff 7 May  9 21:02 ./file.txt'
        )
      ).toBe(true)
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
