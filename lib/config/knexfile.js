const isSQLiteClient = (client) =>
  client === 'better-sqlite3' || client === 'sqlite3'

const getPostgresSslConfig = () => {
  const sslMode = process.env.ACTIVITIES_DATABASE_PG_SSL_MODE
  if (!sslMode || sslMode === 'disable') return null

  return {
    rejectUnauthorized: sslMode === 'verify-ca' || sslMode === 'verify-full',
    ...(sslMode === 'verify-ca' ? { checkServerIdentity: () => undefined } : {})
  }
}

const getDefaultDevDatabase = () => ({
  client: 'better-sqlite3',
  useNullAsDefault: true,
  connection: {
    filename:
      process.env.ACTIVITIES_DEFAULT_DATABASE_SQLITE_FILENAME ||
      './activities.sqlite'
  }
})

// ACTIVITIES_DATABASE holds the whole Knex configuration as a JSON string and
// wins over the individual ACTIVITIES_DATABASE_* variables, exactly like
// getDatabaseConfig in database.ts. Failing loudly on bad JSON matters: falling
// through would silently migrate the default local SQLite file instead of the
// database the operator configured.
const getJsonDatabaseConfig = () => {
  const raw = process.env.ACTIVITIES_DATABASE
  if (!raw) return null

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('ACTIVITIES_DATABASE must be a JSON Knex configuration')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ACTIVITIES_DATABASE must be a JSON Knex configuration')
  }

  return parsed
}

export const getKnexfileDatabaseConfig = () => {
  const jsonConfig = getJsonDatabaseConfig()
  if (jsonConfig) return jsonConfig

  // A bare SQLITE_FILENAME implies SQLite, so it must not leave the client
  // undefined and make every knex command fail.
  const client =
    process.env.ACTIVITIES_DATABASE_CLIENT ||
    (process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME
      ? 'better-sqlite3'
      : undefined)

  if (
    Object.keys(process.env).some((key) =>
      key.startsWith('ACTIVITIES_DATABASE_')
    )
  ) {
    return {
      client,
      ...(isSQLiteClient(client) ? { useNullAsDefault: true } : {}),
      connection: {
        host:
          process.env.ACTIVITIES_DATABASE_PG_HOST ||
          process.env.ACTIVITIES_DATABASE_MYSQL_HOST ||
          process.env.ACTIVITIES_DATABASE_HOST,
        port:
          process.env.ACTIVITIES_DATABASE_PG_PORT ||
          process.env.ACTIVITIES_DATABASE_MYSQL_PORT ||
          process.env.ACTIVITIES_DATABASE_PORT,
        user:
          process.env.ACTIVITIES_DATABASE_PG_USER ||
          process.env.ACTIVITIES_DATABASE_MYSQL_USER ||
          process.env.ACTIVITIES_DATABASE_USER,
        password:
          process.env.ACTIVITIES_DATABASE_PG_PASSWORD ||
          process.env.ACTIVITIES_DATABASE_MYSQL_PASSWORD ||
          process.env.ACTIVITIES_DATABASE_PASSWORD,
        database:
          process.env.ACTIVITIES_DATABASE_PG_DATABASE ||
          process.env.ACTIVITIES_DATABASE_MYSQL_DATABASE,
        filename: process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME,
        ssl: getPostgresSslConfig()
      }
    }
  }

  return getDefaultDevDatabase()
}
