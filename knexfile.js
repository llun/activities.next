const migrationDatabaseConfig = {
  client: 'better-sqlite3',
  useNullAsDefault: true,
  connection: {
    filename:
      process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME || './activities.sqlite'
  }
}

const config = {
  development: migrationDatabaseConfig
}

module.exports = config
