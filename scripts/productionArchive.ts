import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client
} from '@aws-sdk/client-s3'
import { execFile } from 'child_process'
import { createReadStream, createWriteStream } from 'fs'
import fs from 'fs/promises'
import knex, { Knex } from 'knex'
import os from 'os'
import path from 'path'
import { createInterface } from 'readline'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as NodeReadableStream } from 'stream/web'
import { promisify } from 'util'

import { getConfig } from '@/lib/config'
import {
  FitnessStorageConfig,
  FitnessStorageS3Config,
  FitnessStorageType
} from '@/lib/config/fitnessStorage'
import {
  MediaStorageConfig,
  MediaStorageS3Config,
  MediaStorageType
} from '@/lib/config/mediaStorage'

const execFileAsync = promisify(execFile)

const ARCHIVE_VERSION = 2
const DEFAULT_OUTPUT_DIR = 'backups/production-archives'
const DEFAULT_DOWNLOAD_ENV_FILE = '.env.production'
const DEFAULT_RESTORE_ENV_FILE = '.env.local'
const DATABASE_DIR = 'database'
const STORAGE_DIR = 'storage'
const MANIFEST_FILE = 'manifest.json'
const DATABASE_PAGE_SIZE = 1000
const INSERT_BATCH_SIZE = 250

export type StorageScope = 'referenced' | 'all'
export type StorageDestination = 'media' | 'fitness'

export interface DownloadArgs {
  allowMissingStorage: boolean
  envFile: string
  outputDir: string
  skipDatabase: boolean
  skipStorage: boolean
  storageScope: StorageScope
}

export interface RestoreArgs {
  allowNonLocalDatabase: boolean
  archive: string
  databaseOnly: boolean
  envFile: string
  filesOnly: boolean
  preserveFiles: boolean
  safeStorageRoot: string
  yes: boolean
}

export interface ForeignKeyReference {
  fromTable: string
  toTable: string
}

export type StorageSource =
  | {
      kind: 'local'
      path: string
      prefix?: string
    }
  | {
      bucket: string
      hostname?: string
      kind: 's3'
      prefix?: string
      region: string
    }

export interface StoragePlanEntry {
  destination: StorageDestination
  excludePrefixes?: string[]
  files?: string[]
  source: StorageSource
}

interface BuildStoragePlanParams {
  fitnessFilePaths: string[]
  fitnessStorage?: FitnessStorageConfig | null
  mediaFilePaths: string[]
  mediaStorage?: MediaStorageConfig | null
  scope: StorageScope
}

interface ArchiveTableManifest {
  name: string
  rowCount: number
}

interface ArchiveStorageManifest {
  destination: StorageDestination
  failedFiles: { error: string; path: string }[]
  fileCount: number
  source: {
    kind: StorageSource['kind']
    prefix?: string
  }
  totalBytes: number
}

interface ArchiveManifest {
  createdAt: string
  database: {
    client: string
    migrations: string[]
    tables: ArchiveTableManifest[]
  } | null
  source: {
    host: string
    nodeEnv: string | undefined
  }
  storage: ArchiveStorageManifest[]
  storageScope: StorageScope
  version: number
}

interface ReferencedStoragePaths {
  fitnessFilePaths: string[]
  mediaFilePaths: string[]
}

const DOWNLOAD_USAGE = `Usage: NODE_ENV=production scripts/downloadProductionArchive.ts \\
  [--env-file .env.production] \\
  [--output-dir backups/production-archives] \\
  [--storage-scope referenced|all] \\
  [--allow-missing-storage] \\
  [--skip-database] \\
  [--skip-storage]`

const RESTORE_USAGE = `Usage: scripts/restoreProductionArchive.ts \\
  --archive backups/production-archives/activitynext-production-<timestamp>.tar.gz \\
  --yes \\
  [--env-file .env.local] \\
  [--safe-storage-root .] \\
  [--database-only] \\
  [--files-only] \\
  [--preserve-files] \\
  [--allow-non-local-database]`

const parseKeyValueArgs = (args: string[]) => {
  const parsed = new Map<string, string | true>()

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected argument: ${argument}`)
    }

    const [key, inlineValue] = argument.slice(2).split('=', 2)
    if (inlineValue !== undefined) {
      parsed.set(key, inlineValue)
      continue
    }

    const nextValue = args[index + 1]
    if (!nextValue || nextValue.startsWith('--')) {
      parsed.set(key, true)
      continue
    }

    parsed.set(key, nextValue)
    index += 1
  }

  return parsed
}

const getStringArg = (
  args: Map<string, string | true>,
  key: string,
  defaultValue?: string
) => {
  const value = args.get(key)
  if (value === undefined) return defaultValue
  if (value === true) throw new Error(`Missing value for --${key}`)
  return value
}

const getBooleanArg = (args: Map<string, string | true>, key: string) => {
  const value = args.get(key)
  if (value === undefined) return false
  if (value === true) return true
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`Invalid value for --${key}: ${value}. Use true or false.`)
}

export const parseDownloadArgs = (args: string[]): DownloadArgs => {
  const parsed = parseKeyValueArgs(args)
  const storageScope = getStringArg(
    parsed,
    'storage-scope',
    'referenced'
  ) as StorageScope

  if (storageScope !== 'referenced' && storageScope !== 'all') {
    throw new Error(
      `Invalid value for --storage-scope: ${storageScope}. ` +
        'Use referenced or all.'
    )
  }

  return {
    allowMissingStorage: getBooleanArg(parsed, 'allow-missing-storage'),
    envFile: getStringArg(parsed, 'env-file', DEFAULT_DOWNLOAD_ENV_FILE)!,
    outputDir: getStringArg(parsed, 'output-dir', DEFAULT_OUTPUT_DIR)!,
    skipDatabase: getBooleanArg(parsed, 'skip-database'),
    skipStorage: getBooleanArg(parsed, 'skip-storage'),
    storageScope
  }
}

export const parseRestoreArgs = (args: string[]): RestoreArgs => {
  const parsed = parseKeyValueArgs(args)
  const archive = getStringArg(parsed, 'archive')
  if (!archive) throw new Error('Missing required --archive path.')

  const yes = getBooleanArg(parsed, 'yes')
  if (!yes) {
    throw new Error('Restoring replaces local data. Pass --yes to continue.')
  }

  const databaseOnly = getBooleanArg(parsed, 'database-only')
  const filesOnly = getBooleanArg(parsed, 'files-only')
  if (databaseOnly && filesOnly) {
    throw new Error('Use only one of --database-only or --files-only.')
  }

  return {
    allowNonLocalDatabase: getBooleanArg(parsed, 'allow-non-local-database'),
    archive,
    databaseOnly,
    envFile: getStringArg(parsed, 'env-file', DEFAULT_RESTORE_ENV_FILE)!,
    filesOnly,
    preserveFiles: getBooleanArg(parsed, 'preserve-files'),
    safeStorageRoot: getStringArg(parsed, 'safe-storage-root', '.')!,
    yes
  }
}

export const isLocalDatabaseConnection = (connection: unknown): boolean => {
  if (typeof connection === 'string') {
    try {
      return isLocalHost(new URL(connection).hostname)
    } catch {
      return false
    }
  }

  if (!connection || typeof connection !== 'object') return false

  const filename = (connection as { filename?: unknown }).filename
  if (typeof filename === 'string' && filename.trim().length > 0) return true

  const host = (connection as { host?: unknown }).host
  if (typeof host !== 'string' || host.trim().length === 0) return false
  return isLocalHost(host)
}

export const isLocalDatabaseConfig = (databaseConfig: Knex.Config) => {
  const client = String(databaseConfig.client)

  if (client === 'better-sqlite3' || client === 'sqlite3') {
    const connection = databaseConfig.connection
    if (typeof connection === 'string') return connection.trim().length > 0
    if (!connection || typeof connection !== 'object') return false

    const filename = (connection as { filename?: unknown }).filename
    return typeof filename === 'string' && filename.trim().length > 0
  }

  if (
    client === 'pg' ||
    client === 'pg-native' ||
    client === 'mysql' ||
    client === 'mysql2'
  ) {
    return isLocalDatabaseConnection(databaseConfig.connection)
  }

  return false
}

export const sortTablesForRestore = (
  tables: string[],
  foreignKeys: ForeignKeyReference[]
) => {
  const tableSet = new Set(tables)
  const dependencies = new Map<string, Set<string>>()

  for (const table of tables) {
    dependencies.set(table, new Set())
  }

  for (const foreignKey of foreignKeys) {
    if (foreignKey.fromTable === foreignKey.toTable) continue
    if (!tableSet.has(foreignKey.fromTable)) continue
    if (!tableSet.has(foreignKey.toTable)) continue
    dependencies.get(foreignKey.fromTable)?.add(foreignKey.toTable)
  }

  const ordered: string[] = []
  const remaining = new Set(tables)

  while (remaining.size > 0) {
    const ready = [...remaining].filter((table) => {
      const tableDependencies = dependencies.get(table) ?? new Set()
      return [...tableDependencies].every((dependency) => {
        return !remaining.has(dependency)
      })
    })

    if (ready.length === 0) {
      throw new Error(
        'Cannot determine restore order because archived tables have a ' +
          `foreign-key cycle: ${[...remaining].sort().join(', ')}`
      )
    }

    for (const table of ready) {
      ordered.push(table)
      remaining.delete(table)
    }
  }

  return ordered
}

export const buildStoragePlan = ({
  fitnessFilePaths,
  fitnessStorage,
  mediaFilePaths,
  mediaStorage,
  scope
}: BuildStoragePlanParams): StoragePlanEntry[] => {
  const plan: StoragePlanEntry[] = []
  const sharedS3FitnessPrefix = getSharedS3FitnessPrefix(
    mediaStorage,
    fitnessStorage
  )
  const sharedLocalFitnessPrefix = getSharedLocalFitnessPrefix(
    mediaStorage,
    fitnessStorage
  )
  const sharedFitnessPrefixes = uniqueSortedPaths([
    sharedLocalFitnessPrefix,
    sharedS3FitnessPrefix
  ])

  if (mediaStorage) {
    const mediaFiles =
      scope === 'referenced'
        ? uniqueSortedPaths(mediaFilePaths).filter((filePath) => {
            return !sharedFitnessPrefixes.some((prefix) => {
              return isStoragePathInsidePrefix(filePath, prefix)
            })
          })
        : undefined
    const excludePrefixes = scope === 'all' ? sharedFitnessPrefixes : []

    plan.push({
      destination: 'media',
      ...(excludePrefixes.length > 0
        ? { excludePrefixes }
        : null),
      ...(mediaFiles ? { files: mediaFiles } : null),
      source: storageSourceFromMediaConfig(mediaStorage)
    })
  }

  if (fitnessStorage) {
    plan.push({
      destination: 'fitness',
      ...(scope === 'referenced'
        ? { files: uniqueSortedPaths(fitnessFilePaths) }
        : null),
      source: storageSourceFromFitnessConfig(fitnessStorage)
    })
  }

  return plan
}

const isLocalHost = (host: string) =>
  [
    'localhost',
    '127.0.0.1',
    '::1',
    '[::1]',
    '0.0.0.0',
    'postgres',
    'host.docker.internal'
  ].includes(host.trim().toLowerCase())

const uniqueSortedPaths = (filePaths: (string | null | undefined)[]) =>
  [...new Set(filePaths.map(normalizeStoragePath).filter(Boolean))].sort()

const normalizeStoragePath = (filePath: string | null | undefined) => {
  if (!filePath) return ''
  const normalized = filePath
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
  if (normalized.includes('..')) return ''
  return normalized
}

const isStoragePathInsidePrefix = (filePath: string, prefix: string) => {
  const normalizedPrefix = normalizeStoragePath(prefix)
  if (!normalizedPrefix) return false
  return (
    filePath === normalizedPrefix ||
    filePath.startsWith(`${normalizedPrefix}/`)
  )
}

const storageSourceFromMediaConfig = (
  storage: MediaStorageConfig
): StorageSource => {
  switch (storage.type) {
    case MediaStorageType.LocalFile:
      return {
        kind: 'local',
        path: storage.path
      }
    case MediaStorageType.ObjectStorage:
    case MediaStorageType.S3Storage:
      return {
        bucket: storage.bucket,
        ...(storage.hostname ? { hostname: storage.hostname } : null),
        kind: 's3',
        prefix: undefined,
        region: storage.region
      }
  }
}

const storageSourceFromFitnessConfig = (
  storage: FitnessStorageConfig
): StorageSource => {
  switch (storage.type) {
    case FitnessStorageType.LocalFile:
      return {
        kind: 'local',
        path: storage.path
      }
    case FitnessStorageType.ObjectStorage:
    case FitnessStorageType.S3Storage:
      return {
        bucket: storage.bucket,
        ...(storage.hostname ? { hostname: storage.hostname } : null),
        kind: 's3',
        prefix: storage.prefix,
        region: storage.region
      }
  }
}

const getSharedS3FitnessPrefix = (
  mediaStorage?: MediaStorageConfig | null,
  fitnessStorage?: FitnessStorageConfig | null
) => {
  if (!mediaStorage || !fitnessStorage) return null
  if (!isS3MediaStorage(mediaStorage) || !isS3FitnessStorage(fitnessStorage)) {
    return null
  }

  if (mediaStorage.bucket !== fitnessStorage.bucket) return null
  if (mediaStorage.region !== fitnessStorage.region) return null
  return fitnessStorage.prefix || null
}

const getSharedLocalFitnessPrefix = (
  mediaStorage?: MediaStorageConfig | null,
  fitnessStorage?: FitnessStorageConfig | null
) => {
  if (!mediaStorage || !fitnessStorage) return null
  if (
    mediaStorage.type !== MediaStorageType.LocalFile ||
    fitnessStorage.type !== FitnessStorageType.LocalFile
  ) {
    return null
  }

  const mediaPath = path.resolve(mediaStorage.path)
  const fitnessPath = path.resolve(fitnessStorage.path)
  const relativeFitnessPath = path.relative(mediaPath, fitnessPath)

  if (
    relativeFitnessPath.startsWith('..') ||
    path.isAbsolute(relativeFitnessPath)
  ) {
    return null
  }

  return normalizeStoragePath(relativeFitnessPath)
}

const isS3MediaStorage = (
  storage: MediaStorageConfig
): storage is MediaStorageS3Config =>
  storage.type === MediaStorageType.ObjectStorage ||
  storage.type === MediaStorageType.S3Storage

const isS3FitnessStorage = (
  storage: FitnessStorageConfig
): storage is FitnessStorageS3Config =>
  storage.type === FitnessStorageType.ObjectStorage ||
  storage.type === FitnessStorageType.S3Storage

const parseEnvFile = (content: string) => {
  const values: Record<string, string> = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const normalizedLine = line.startsWith('export ')
      ? line.slice('export '.length).trim()
      : line
    const separatorIndex = normalizedLine.indexOf('=')
    if (separatorIndex < 1) continue

    const key = normalizedLine.slice(0, separatorIndex).trim()
    const rawValue = normalizedLine.slice(separatorIndex + 1).trim()

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    values[key] = parseEnvValue(rawValue)
  }

  return values
}

const parseEnvValue = (rawValue: string) => {
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    const quote = rawValue[0]
    const unquoted = rawValue.slice(1, -1)
    if (quote === "'") return unquoted
    return unquoted
      .replaceAll('\\n', '\n')
      .replaceAll('\\"', '"')
      .replaceAll('\\\\', '\\')
  }

  return rawValue.replace(/\s+#.*$/, '')
}

const loadEnvFile = async (envFile: string) => {
  const envPath = path.resolve(process.cwd(), envFile)
  const content = await fs.readFile(envPath, 'utf-8')
  const values = parseEnvFile(content)

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value
  }
}

const createArchiveName = () => {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(':', '')
    .replaceAll('.', '')
  return `activitynext-production-${timestamp}.tar.gz`
}

const quoteIdentifier = (identifier: string) =>
  `"${identifier.replaceAll('"', '""')}"`

const tableFileName = (tableName: string) =>
  `${encodeURIComponent(tableName)}.jsonl`

const assertRelativeFilePath = (filePath: string) => {
  const normalized = normalizeStoragePath(filePath)
  if (!normalized || normalized.startsWith('../') || normalized === '..') {
    throw new Error(`Invalid archive file path: ${filePath}`)
  }
  return normalized
}

const getKnexClientName = (database: Knex) =>
  String(database.client.config.client)

const getQueryRows = <T>(result: unknown): T[] => {
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: T[] }).rows
  }

  return result as T[]
}

const getDatabaseTableNames = async (database: Knex) => {
  const client = getKnexClientName(database)

  if (client === 'pg' || client === 'pg-native') {
    const result = await database.raw(`
      select table_name as name
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
      order by table_name asc
    `)
    return getQueryRows<{ name: string }>(result).map((row) => row.name)
  }

  if (client === 'better-sqlite3' || client === 'sqlite3') {
    const rows = await database('sqlite_master')
      .select('name')
      .where('type', 'table')
      .whereNot('name', 'sqlite_sequence')
      .orderBy('name', 'asc')
    return rows.map((row: { name: string }) => row.name)
  }

  throw new Error(`Unsupported database client for archive: ${client}`)
}

const getMigrationNames = async (database: Knex) => {
  if (!(await database.schema.hasTable('knex_migrations'))) return []

  const rows = await database('knex_migrations')
    .select('name')
    .orderBy('id', 'asc')

  return rows
    .map((row: { name?: unknown }) => row.name)
    .filter((name): name is string => typeof name === 'string')
}

const createTableRowsStream = (
  database: Knex,
  tableName: string,
  onRow: () => void
) => {
  async function* rowsToJsonLines() {
    let offset = 0

    for (;;) {
      const rows = await database(tableName)
        .select('*')
        .limit(DATABASE_PAGE_SIZE)
        .offset(offset)

      if (rows.length === 0) return

      for (const row of rows) {
        onRow()
        yield `${JSON.stringify(row)}\n`
      }

      offset += rows.length
    }
  }

  return Readable.from(rowsToJsonLines())
}

const exportDatabase = async (database: Knex, outputDir: string) => {
  const databaseDir = path.join(outputDir, DATABASE_DIR)
  await fs.mkdir(databaseDir, { recursive: true })

  const tableNames = await getDatabaseTableNames(database)
  const migrations = await getMigrationNames(database)
  const tables: ArchiveTableManifest[] = []

  for (const tableName of tableNames) {
    let rowCount = 0
    await pipeline(
      createTableRowsStream(database, tableName, () => {
        rowCount += 1
      }),
      createWriteStream(path.join(databaseDir, tableFileName(tableName)))
    )
    tables.push({ name: tableName, rowCount })
    console.log(`Database: exported ${rowCount} row(s) from ${tableName}`)
  }

  return {
    client: getKnexClientName(database),
    migrations,
    tables
  }
}

const tableExists = async (database: Knex, tableName: string) =>
  database.schema.hasTable(tableName)

const getReferencedStoragePaths = async (
  database: Knex
): Promise<ReferencedStoragePaths> => {
  const mediaFilePaths: string[] = []
  const fitnessFilePaths: string[] = []

  if (await tableExists(database, 'medias')) {
    let offset = 0
    for (;;) {
      const mediaRows = await database('medias')
        .select('original', 'thumbnail')
        .orderBy('id', 'asc')
        .limit(DATABASE_PAGE_SIZE)
        .offset(offset)

      if (mediaRows.length === 0) break

      for (const row of mediaRows) {
        if (typeof row.original === 'string') mediaFilePaths.push(row.original)
        if (typeof row.thumbnail === 'string') {
          mediaFilePaths.push(row.thumbnail)
        }
      }

      offset += mediaRows.length
    }
  }

  if (await tableExists(database, 'fitness_files')) {
    let offset = 0
    for (;;) {
      const fitnessRows = await database('fitness_files')
        .select('path', 'mapImagePath')
        .orderBy('id', 'asc')
        .limit(DATABASE_PAGE_SIZE)
        .offset(offset)

      if (fitnessRows.length === 0) break

      for (const row of fitnessRows) {
        if (typeof row.path === 'string') fitnessFilePaths.push(row.path)
        if (typeof row.mapImagePath === 'string') {
          mediaFilePaths.push(row.mapImagePath)
        }
      }

      offset += fitnessRows.length
    }
  }

  return {
    fitnessFilePaths: uniqueSortedPaths(fitnessFilePaths),
    mediaFilePaths: uniqueSortedPaths(mediaFilePaths)
  }
}

const createS3Client = (source: Extract<StorageSource, { kind: 's3' }>) =>
  new S3Client({ region: source.region })

const listS3Files = async (
  source: Extract<StorageSource, { kind: 's3' }>,
  client: S3Client
) => {
  const files: string[] = []
  let continuationToken: string | undefined

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: source.bucket,
        ContinuationToken: continuationToken,
        Prefix: source.prefix
      })
    )

    for (const object of response.Contents ?? []) {
      if (!object.Key) continue
      const relativePath = source.prefix
        ? object.Key.slice(source.prefix.length)
        : object.Key
      files.push(relativePath)
    }

    continuationToken = response.NextContinuationToken
  } while (continuationToken)

  return uniqueSortedPaths(files)
}

const listLocalFiles = async (basePath: string) => {
  const files: string[] = []

  async function traverse(currentPath: string, relativePath = '') {
    const entries = await fs.readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)
      const nextRelativePath = relativePath
        ? path.join(relativePath, entry.name)
        : entry.name

      if (entry.isDirectory()) {
        await traverse(fullPath, nextRelativePath)
      } else if (entry.isFile()) {
        files.push(nextRelativePath)
      }
    }
  }

  try {
    await traverse(basePath)
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code !== 'ENOENT') throw error
  }

  return uniqueSortedPaths(files)
}

const shouldExcludeStorageFile = (
  filePath: string,
  excludePrefixes?: string[]
) =>
  Boolean(
    excludePrefixes?.some((prefix) => {
      return isStoragePathInsidePrefix(filePath, prefix)
    })
  )

const getStorageFiles = async (
  entry: StoragePlanEntry,
  s3Client?: S3Client
) => {
  const allFiles =
    entry.files ??
    (entry.source.kind === 's3'
      ? await listS3Files(entry.source, s3Client ?? createS3Client(entry.source))
      : await listLocalFiles(path.resolve(entry.source.path)))

  return allFiles.filter((filePath) => {
    return !shouldExcludeStorageFile(filePath, entry.excludePrefixes)
  })
}

const copyLocalStorageFile = async ({
  archiveFilePath,
  relativeFilePath,
  source
}: {
  archiveFilePath: string
  relativeFilePath: string
  source: Extract<StorageSource, { kind: 'local' }>
}) => {
  const sourcePath = path.resolve(source.path, relativeFilePath)
  await fs.mkdir(path.dirname(archiveFilePath), { recursive: true })
  await fs.copyFile(sourcePath, archiveFilePath)
  return (await fs.stat(archiveFilePath)).size
}

const downloadS3StorageFile = async ({
  archiveFilePath,
  client,
  relativeFilePath,
  source
}: {
  archiveFilePath: string
  client: S3Client
  relativeFilePath: string
  source: Extract<StorageSource, { kind: 's3' }>
}) => {
  const key = source.prefix
    ? `${source.prefix}${relativeFilePath}`
    : relativeFilePath
  let response

  try {
    response = await client.send(
      new GetObjectCommand({
        Bucket: source.bucket,
        Key: key
      })
    )
  } catch (error) {
    if (!source.hostname) throw error
    return downloadPublicStorageFile({
      archiveFilePath,
      hostname: source.hostname,
      key
    })
  }

  if (!response.Body) {
    throw new Error(`S3 object has no body: ${key}`)
  }

  await fs.mkdir(path.dirname(archiveFilePath), { recursive: true })

  const body = response.Body as Readable & {
    transformToByteArray?: () => Promise<Uint8Array>
    transformToWebStream?: () => ReadableStream<Uint8Array>
  }

  if (typeof body.transformToWebStream === 'function') {
    await pipeline(
      Readable.fromWeb(
        body.transformToWebStream() as unknown as NodeReadableStream<Uint8Array>
      ),
      createWriteStream(archiveFilePath)
    )
  } else if (typeof body.pipe === 'function') {
    await pipeline(body, createWriteStream(archiveFilePath))
  } else if (typeof body.transformToByteArray === 'function') {
    await fs.writeFile(
      archiveFilePath,
      Buffer.from(await body.transformToByteArray())
    )
  } else {
    throw new Error(`Unsupported S3 body stream for ${key}`)
  }

  return (await fs.stat(archiveFilePath)).size
}

const downloadPublicStorageFile = async ({
  archiveFilePath,
  hostname,
  key
}: {
  archiveFilePath: string
  hostname: string
  key: string
}) => {
  const normalizedHostname = hostname.replace(/^https?:\/\//, '')
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  const response = await fetch(`https://${normalizedHostname}/${encodedKey}`)

  if (!response.ok) {
    throw new Error(
      `Failed to download ${key} from public storage: HTTP ${response.status}`
    )
  }

  await fs.mkdir(path.dirname(archiveFilePath), { recursive: true })

  if (response.body) {
    await pipeline(
      Readable.fromWeb(
        response.body as unknown as NodeReadableStream<Uint8Array>
      ),
      createWriteStream(archiveFilePath)
    )
  } else {
    await fs.writeFile(
      archiveFilePath,
      Buffer.from(await response.arrayBuffer())
    )
  }

  return (await fs.stat(archiveFilePath)).size
}

const archiveStorage = async (
  plan: StoragePlanEntry[],
  stagingDir: string,
  options: { allowMissingStorage: boolean }
): Promise<ArchiveStorageManifest[]> => {
  const storageManifests: ArchiveStorageManifest[] = []

  for (const entry of plan) {
    const s3Client =
      entry.source.kind === 's3' ? createS3Client(entry.source) : undefined
    try {
      const files = await getStorageFiles(entry, s3Client)
      let totalBytes = 0
      let downloadedCount = 0
      const failedFiles: { error: string; path: string }[] = []

      for (const filePath of files) {
        const relativeFilePath = assertRelativeFilePath(filePath)
        const archiveFilePath = path.join(
          stagingDir,
          STORAGE_DIR,
          entry.destination,
          'files',
          relativeFilePath
        )

        let size: number
        try {
          size =
            entry.source.kind === 's3'
              ? await downloadS3StorageFile({
                  archiveFilePath,
                  client: s3Client!,
                  relativeFilePath,
                  source: entry.source
                })
              : await copyLocalStorageFile({
                  archiveFilePath,
                  relativeFilePath,
                  source: entry.source
                })
        } catch (error) {
          const nodeError = error as Error
          if (!options.allowMissingStorage) throw error

          failedFiles.push({
            error: nodeError.message,
            path: relativeFilePath
          })
          console.error(
            `Storage: failed to download ${entry.destination} file ` +
              `${relativeFilePath}: ${nodeError.message}`
          )
          continue
        }

        totalBytes += size
        downloadedCount += 1

        if (downloadedCount % 25 === 0) {
          console.log(
            `Storage: downloaded ${downloadedCount}/${files.length} ` +
              `${entry.destination} file(s)`
          )
        }
      }

      console.log(
        `Storage: downloaded ${downloadedCount} ${entry.destination} file(s)`
      )

      storageManifests.push({
        destination: entry.destination,
        failedFiles,
        fileCount: downloadedCount,
        source: redactStorageSource(entry.source),
        totalBytes
      })
    } finally {
      s3Client?.destroy()
    }
  }

  return storageManifests
}

const redactStorageSource = (source: StorageSource) => ({
  kind: source.kind,
  ...(source.prefix ? { prefix: source.prefix } : null)
})

const writeManifest = async (stagingDir: string, manifest: ArchiveManifest) => {
  await fs.writeFile(
    path.join(stagingDir, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`
  )
}

const createTarArchive = async (stagingDir: string, archivePath: string) => {
  await fs.mkdir(path.dirname(archivePath), { recursive: true })
  await execFileAsync('tar', ['-czf', archivePath, '-C', stagingDir, '.'])
}

export const isSafeArchiveEntryPath = (entry: string) => {
  if (!entry) return false
  if (path.posix.isAbsolute(entry)) return false

  const normalized = path.posix.normalize(entry)
  return normalized !== '..' && !normalized.startsWith('../')
}

const validateTarArchivePaths = async (archivePath: string) => {
  const { stdout } = await execFileAsync('tar', ['-tzf', archivePath], {
    maxBuffer: 64 * 1024 * 1024
  })

  for (const entry of stdout.split(/\r?\n/)) {
    if (!entry) continue
    if (!isSafeArchiveEntryPath(entry)) {
      throw new Error(`Archive contains unsafe path: ${entry}`)
    }
  }
}

const extractTarArchive = async (archivePath: string, outputDir: string) => {
  await fs.mkdir(outputDir, { recursive: true })
  await validateTarArchivePaths(archivePath)
  await execFileAsync('tar', ['-xzf', archivePath, '-C', outputDir])
}

const readManifest = async (archiveDir: string): Promise<ArchiveManifest> => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(archiveDir, MANIFEST_FILE), 'utf-8')
  ) as ArchiveManifest

  if (manifest.version !== ARCHIVE_VERSION) {
    throw new Error(
      `Unsupported archive version: ${manifest.version}. ` +
        `Expected ${ARCHIVE_VERSION}.`
    )
  }

  return manifest
}

const ensureRestoreTargetIsLocal = (
  config: ReturnType<typeof getConfig>,
  args: RestoreArgs
) => {
  if (args.allowNonLocalDatabase) return

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to restore while NODE_ENV=production. ' +
        'Unset NODE_ENV or pass --allow-non-local-database.'
    )
  }

  if (path.basename(args.envFile) === '.env.production') {
    throw new Error(
      'Refusing to restore using .env.production. Use .env.local instead.'
    )
  }

  if (!isLocalDatabaseConfig(config.database)) {
    throw new Error(
      'Refusing to restore to a non-local database host. ' +
        'Pass --allow-non-local-database only if this is intentional.'
    )
  }
}

const getForeignKeyReferences = async (
  database: Knex,
  tables: string[]
): Promise<ForeignKeyReference[]> => {
  const client = getKnexClientName(database)

  if (client === 'pg' || client === 'pg-native') {
    const result = await database.raw(`
      select
        tc.table_name as "fromTable",
        ccu.table_name as "toTable"
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
        and tc.table_schema = kcu.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
        and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = 'public'
    `)
    return getQueryRows<ForeignKeyReference>(result)
  }

  if (client === 'better-sqlite3' || client === 'sqlite3') {
    const references: ForeignKeyReference[] = []
    for (const table of tables) {
      const rows = await database.raw(
        `PRAGMA foreign_key_list(${quoteIdentifier(table)})`
      )
      for (const row of getQueryRows<{ table: string }>(rows)) {
        references.push({
          fromTable: table,
          toTable: row.table
        })
      }
    }
    return references
  }

  throw new Error(`Unsupported database client for restore: ${client}`)
}

const truncateTables = async (database: Knex, tableNames: string[]) => {
  const client = getKnexClientName(database)
  if (tableNames.length === 0) return

  if (client === 'pg' || client === 'pg-native') {
    const tables = tableNames.map(quoteIdentifier).join(', ')
    await database.raw(`truncate table ${tables} restart identity`)
    return
  }

  if (client === 'better-sqlite3' || client === 'sqlite3') {
    await database.raw('PRAGMA foreign_keys = OFF')
    try {
      for (const tableName of tableNames) {
        await database(tableName).delete()
      }
      if (await database.schema.hasTable('sqlite_sequence')) {
        await database('sqlite_sequence').whereIn('name', tableNames).delete()
      }
    } finally {
      await database.raw('PRAGMA foreign_keys = ON')
    }
    return
  }

  throw new Error(`Unsupported database client for restore: ${client}`)
}

const assertMatchingMigrations = (
  archiveMigrations: string[],
  localMigrations: string[]
) => {
  const archiveValue = JSON.stringify(archiveMigrations)
  const localValue = JSON.stringify(localMigrations)
  if (archiveValue === localValue) return

  const archiveSet = new Set(archiveMigrations)
  const localSet = new Set(localMigrations)
  const missingLocally = archiveMigrations.filter((name) => !localSet.has(name))
  const extraLocally = localMigrations.filter((name) => !archiveSet.has(name))

  throw new Error(
    'Local database migration state does not match the archive. ' +
      'Restore with code that matches the archive before replacing data. ' +
      `Missing locally: ${missingLocally.join(', ') || 'none'}. ` +
      `Extra locally: ${extraLocally.join(', ') || 'none'}.`
  )
}

const ensureArchiveSchemaMatchesLocal = async (
  database: Knex,
  archiveMigrations: string[]
) => {
  const migrationsBeforeLatest = await getMigrationNames(database)

  if (migrationsBeforeLatest.length > 0) {
    assertMatchingMigrations(archiveMigrations, migrationsBeforeLatest)
    return
  }

  await database.migrate.latest()
  assertMatchingMigrations(archiveMigrations, await getMigrationNames(database))
}

const restoreTableFromJsonLines = async (
  database: Knex,
  tableName: string,
  tableFilePath: string
) => {
  const input = createReadStream(tableFilePath, { encoding: 'utf-8' })
  const lines = createInterface({
    crlfDelay: Infinity,
    input
  })
  let batch: Record<string, unknown>[] = []
  let rowCount = 0

  const flushBatch = async () => {
    if (batch.length === 0) return
    await database.batchInsert(tableName, batch, INSERT_BATCH_SIZE)
    rowCount += batch.length
    batch = []
  }

  try {
    for await (const line of lines) {
      if (!line.trim()) continue

      batch.push(JSON.parse(line) as Record<string, unknown>)
      if (batch.length >= INSERT_BATCH_SIZE) {
        await flushBatch()
      }
    }

    await flushBatch()
  } finally {
    lines.close()
    input.destroy()
  }

  return rowCount
}

const resetPostgresSequences = async (database: Knex, tableNames: string[]) => {
  const client = getKnexClientName(database)
  if (client !== 'pg' && client !== 'pg-native') return

  for (const tableName of tableNames) {
    const result = await database.raw(
      `
      select
        a.attname as "columnName",
        pg_get_serial_sequence(
          format('%I.%I', n.nspname, c.relname),
          a.attname
        ) as "sequenceName"
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'public'
        and c.relname = ?
        and a.attnum > 0
        and not a.attisdropped
        and pg_get_serial_sequence(
          format('%I.%I', n.nspname, c.relname),
          a.attname
        ) is not null
    `,
      [tableName]
    )

    for (const row of getQueryRows<{
      columnName: string
      sequenceName: string
    }>(result)) {
      await database.raw(
        `
        select setval(
          ?,
          coalesce(
            (select max(${quoteIdentifier(row.columnName)})
             from ${quoteIdentifier(tableName)}),
            1
          ),
          exists(select 1 from ${quoteIdentifier(tableName)})
        )
      `,
        [row.sequenceName]
      )
    }
  }
}

const restoreDatabase = async (
  database: Knex,
  archiveDir: string,
  manifest: ArchiveManifest
) => {
  if (!manifest.database) {
    console.log('Database: archive has no database payload, skipping.')
    return
  }

  await ensureArchiveSchemaMatchesLocal(database, manifest.database.migrations)

  const tableNames = manifest.database.tables.map((table) => table.name)
  const localTables = new Set(await getDatabaseTableNames(database))
  const missingTables = tableNames.filter((table) => !localTables.has(table))
  if (missingTables.length > 0) {
    throw new Error(
      `Local database is missing archived table(s): ${missingTables.join(', ')}`
    )
  }

  const foreignKeys = await getForeignKeyReferences(database, tableNames)
  const orderedTables = sortTablesForRestore(tableNames, foreignKeys)

  await truncateTables(database, tableNames)

  for (const tableName of orderedTables) {
    const rowCount = await restoreTableFromJsonLines(
      database,
      tableName,
      path.join(archiveDir, DATABASE_DIR, tableFileName(tableName))
    )

    console.log(`Database: restored ${rowCount} row(s) into ${tableName}`)
  }

  await resetPostgresSequences(database, tableNames)
}

const resolveLocalStoragePath = (
  destination: StorageDestination,
  config: ReturnType<typeof getConfig>
) => {
  if (destination === 'media') {
    if (config.mediaStorage?.type !== MediaStorageType.LocalFile) {
      throw new Error('Local restore requires media storage type fs.')
    }
    return config.mediaStorage.path
  }

  if (config.fitnessStorage?.type !== FitnessStorageType.LocalFile) {
    throw new Error('Local restore requires fitness storage type fs.')
  }
  return config.fitnessStorage.path
}

const pathIsInside = (childPath: string, parentPath: string) => {
  const relativePath = path.relative(parentPath, childPath)
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith('..') &&
    !path.isAbsolute(relativePath)
  )
}

export const assertSafeDirectoryToReplace = (
  directoryPath: string,
  safeStorageRoot = '.'
) => {
  if (!directoryPath.trim()) {
    throw new Error('Refusing to replace empty directory path.')
  }

  if (!safeStorageRoot.trim()) {
    throw new Error('Refusing to use empty safe storage root.')
  }

  const resolved = path.resolve(directoryPath)
  const resolvedSafeRoot = path.resolve(safeStorageRoot)
  const root = path.parse(resolved).root
  const homeDir = os.homedir()
  const cwd = process.cwd()
  const unsafePaths = new Set([
    root,
    homeDir,
    cwd,
    path.join(homeDir, 'Desktop'),
    path.join(homeDir, 'Documents'),
    path.join(homeDir, 'Downloads'),
    path.join(homeDir, 'Movies'),
    path.join(homeDir, 'Music'),
    path.join(homeDir, 'Pictures'),
    os.tmpdir()
  ])

  if (unsafePaths.has(resolved)) {
    throw new Error(`Refusing to replace unsafe directory: ${resolved}`)
  }

  if (!pathIsInside(resolved, resolvedSafeRoot)) {
    throw new Error(
      `Refusing to replace directory outside safe storage root: ` +
        `${resolved}. Safe root: ${resolvedSafeRoot}`
    )
  }

  return resolved
}

const emptyDirectory = async (directoryPath: string) => {
  await fs.rm(directoryPath, { force: true, recursive: true })
  await fs.mkdir(directoryPath, { recursive: true })
}

const copyDirectoryContents = async (
  fromDir: string,
  toDir: string
): Promise<number> => {
  const entries = await fs.readdir(fromDir, { withFileTypes: true })
  await fs.mkdir(toDir, { recursive: true })
  let copiedCount = 0

  for (const entry of entries) {
    const sourcePath = path.join(fromDir, entry.name)
    const destinationPath = path.join(toDir, entry.name)

    if (entry.isDirectory()) {
      copiedCount += await copyDirectoryContents(sourcePath, destinationPath)
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true })
      await fs.copyFile(sourcePath, destinationPath)
      copiedCount += 1
    }
  }

  return copiedCount
}

const getStoragePayloadDir = (
  archiveDir: string,
  destination: StorageDestination
) => path.join(archiveDir, STORAGE_DIR, destination, 'files')

const assertStoragePayloadsExist = async (
  archiveDir: string,
  storageManifest: ArchiveStorageManifest[]
) => {
  for (const storage of storageManifest) {
    if (storage.fileCount === 0) continue

    const payloadDir = getStoragePayloadDir(archiveDir, storage.destination)
    const stat = await fs.stat(payloadDir).catch((error) => {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code !== 'ENOENT') throw error
      throw new Error(
        `Archive is missing ${storage.destination} storage payload: ` +
          payloadDir
      )
    })

    if (!stat.isDirectory()) {
      throw new Error(
        `Archive storage payload is not a directory: ${payloadDir}`
      )
    }
  }
}

const getRestoreStorageTargets = (
  manifest: ArchiveManifest,
  config: ReturnType<typeof getConfig>,
  safeStorageRoot: string
) =>
  manifest.storage.map((storage) => ({
    destinationPath: assertSafeDirectoryToReplace(
      resolveLocalStoragePath(storage.destination, config),
      safeStorageRoot
    ),
    storage
  }))

const restoreStorage = async (
  archiveDir: string,
  manifest: ArchiveManifest,
  config: ReturnType<typeof getConfig>,
  args: RestoreArgs
) => {
  await assertStoragePayloadsExist(archiveDir, manifest.storage)
  const restoreTargets = getRestoreStorageTargets(
    manifest,
    config,
    args.safeStorageRoot
  )

  for (const { destinationPath, storage } of restoreTargets) {
    if (!args.preserveFiles) {
      await emptyDirectory(destinationPath)
    } else {
      await fs.mkdir(destinationPath, { recursive: true })
    }

    const copiedCount =
      storage.fileCount > 0
        ? await copyDirectoryContents(
            getStoragePayloadDir(archiveDir, storage.destination),
            destinationPath
          )
        : 0

    if (copiedCount !== storage.fileCount) {
      throw new Error(
        `Archive ${storage.destination} storage payload expected ` +
          `${storage.fileCount} file(s), copied ${copiedCount}.`
      )
    }

    console.log(
      `Storage: restored ${storage.fileCount} ` +
        `${storage.destination} file(s) to ${destinationPath}`
    )
  }
}

const createDatabase = () => {
  const config = getConfig()
  return knex(config.database)
}

export const downloadProductionArchive = async (
  cliArgs = process.argv.slice(2)
) => {
  if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
    console.log(DOWNLOAD_USAGE)
    return 0
  }

  const args = parseDownloadArgs(cliArgs)

  await loadEnvFile(args.envFile)

  const config = getConfig()
  const outputDir = path.resolve(process.cwd(), args.outputDir)
  const stagingDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'activitynext-production-archive-')
  )
  const archivePath = path.join(outputDir, createArchiveName())
  const database = createDatabase()

  try {
    const databaseManifest = args.skipDatabase
      ? null
      : await exportDatabase(database, stagingDir)

    const storagePaths =
      args.skipStorage || args.storageScope === 'all'
        ? { fitnessFilePaths: [], mediaFilePaths: [] }
        : await getReferencedStoragePaths(database)

    const storageManifest = args.skipStorage
      ? []
      : await archiveStorage(
          buildStoragePlan({
            fitnessFilePaths: storagePaths.fitnessFilePaths,
            fitnessStorage: config.fitnessStorage,
            mediaFilePaths: storagePaths.mediaFilePaths,
            mediaStorage: config.mediaStorage,
            scope: args.storageScope
          }),
          stagingDir,
          { allowMissingStorage: args.allowMissingStorage }
        )

    await writeManifest(stagingDir, {
      createdAt: new Date().toISOString(),
      database: databaseManifest,
      source: {
        host: config.host,
        nodeEnv: process.env.NODE_ENV
      },
      storage: storageManifest,
      storageScope: args.storageScope,
      version: ARCHIVE_VERSION
    })

    await createTarArchive(stagingDir, archivePath)
    console.log(`Archive written: ${archivePath}`)
    return 0
  } finally {
    await database.destroy()
    await fs.rm(stagingDir, { force: true, recursive: true })
  }
}

export const restoreProductionArchive = async (
  cliArgs = process.argv.slice(2)
) => {
  if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
    console.log(RESTORE_USAGE)
    return 0
  }

  const args = parseRestoreArgs(cliArgs)

  await loadEnvFile(args.envFile)
  const config = getConfig()
  ensureRestoreTargetIsLocal(config, args)

  const archiveDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'activitynext-production-restore-')
  )
  const database = createDatabase()

  try {
    await extractTarArchive(path.resolve(args.archive), archiveDir)
    const manifest = await readManifest(archiveDir)

    if (!args.filesOnly) {
      await restoreDatabase(database, archiveDir, manifest)
    }

    if (!args.databaseOnly) {
      await restoreStorage(archiveDir, manifest, config, args)
    }

    console.log('Restore complete.')
    return 0
  } finally {
    await database.destroy()
    await fs.rm(archiveDir, { force: true, recursive: true })
  }
}
