import dotenvFlow from 'dotenv-flow'

dotenvFlow.config()

const DEFAULT_DEV_DATABASE = {
  client: 'better-sqlite3',
  useNullAsDefault: true,
  connection: {
    filename:
      process.env.ACTIVITIES_DEFAULT_DATABASE_SQLITE_FILENAME ||
      './activities.sqlite'
  }
}

const getDatabaseConfig = () => {
  if (
    Object.keys(process.env).some((key) =>
      key.startsWith('ACTIVITIES_DATABASE_')
    )
  ) {
    return {
      client: process.env.ACTIVITIES_DATABASE_CLIENT,
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
        ssl: process.env.ACTIVITIES_DATABASE_PG_SSL_MODE
          ? {
              rejectUnauthorized: false
            }
          : null
      }
    }
  }
  return DEFAULT_DEV_DATABASE
}

const config = {
  development: getDatabaseConfig(),
  production: getDatabaseConfig()
}

export default config
