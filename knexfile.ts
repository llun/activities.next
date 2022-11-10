import type { Knex } from 'knex'

// Update with your config settings.

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'better-sqlite3',
    connection: {
      filename: './dev.sqlite3'
    }
  }
}

module.exports = config
