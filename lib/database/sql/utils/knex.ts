import { Knex } from 'knex'

export type KnexConnection = Knex | Knex.Transaction

export const SQLITE_MAX_BINDINGS = 999
const DEFAULT_INSERT_BATCH_SIZE = 1000

const SQLITE_CLIENTS = new Set(['sqlite3', 'better-sqlite3'])
const POSTGRES_CLIENTS = new Set(['pg', 'postgres', 'postgresql'])

export const getClientName = (database: KnexConnection) =>
  String(database.client.config.client).toLowerCase()

export const isSQLiteClient = (database: KnexConnection) =>
  SQLITE_CLIENTS.has(getClientName(database))

export const isPostgresClient = (database: KnexConnection) =>
  POSTGRES_CLIENTS.has(getClientName(database))

export const getWhereInBatchSize = (
  database: KnexConnection,
  reservedBindings = 0,
  defaultBatchSize = 1000
) => {
  if (!isSQLiteClient(database)) return defaultBatchSize
  return Math.max(1, SQLITE_MAX_BINDINGS - reservedBindings)
}

export const getInsertBatchSize = (
  database: KnexConnection,
  row: Record<string, unknown>,
  defaultBatchSize = DEFAULT_INSERT_BATCH_SIZE
) => {
  const boundedDefaultBatchSize = Number.isFinite(defaultBatchSize)
    ? Math.max(1, Math.floor(defaultBatchSize))
    : DEFAULT_INSERT_BATCH_SIZE

  if (!isSQLiteClient(database)) return boundedDefaultBatchSize

  const columnCount = Math.max(1, Object.keys(row).length)
  return Math.min(
    boundedDefaultBatchSize,
    Math.max(1, Math.floor(SQLITE_MAX_BINDINGS / columnCount))
  )
}

export const chunkArray = <T>(items: T[], size: number) => {
  const chunkSize = Number.isFinite(size)
    ? Math.max(1, Math.floor(size))
    : Math.max(items.length, 1)
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += chunkSize) {
    chunks.push(items.slice(start, start + chunkSize))
  }
  return chunks
}
