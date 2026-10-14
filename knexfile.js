import dotenvFlow from 'dotenv-flow'

import {
  KNEX_MIGRATIONS,
  getKnexfileDatabaseConfig
} from './lib/config/knexfile.js'

dotenvFlow.config()

const withMigrations = () => ({
  ...getKnexfileDatabaseConfig(),
  migrations: { ...KNEX_MIGRATIONS }
})

const config = {
  development: withMigrations(),
  production: withMigrations(),
  staging: withMigrations()
}

export default config
