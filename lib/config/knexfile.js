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

export const getKnexfileDatabaseConfig = () => {
  const client = process.env.ACTIVITIES_DATABASE_CLIENT

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
          process.env.ACTIVITIES_DATABASE_MYSQL_DATABASE ||
          process.env.ACTIVITIES_DATABASE,
        filename: process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME,
        ssl: getPostgresSslConfig()
      }
    }
  }

  return getDefaultDevDatabase()
}
