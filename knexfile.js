const migrationDatabaseConfig = {
  client: 'better-sqlite3',
  useNullAsDefault: true,
  connection: {
    filename: './dev.sqlite3'
  }
}

const config = {
  development: migrationDatabaseConfig
}

module.exports = config
