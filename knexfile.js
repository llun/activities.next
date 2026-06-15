import dotenvFlow from 'dotenv-flow'

import { getKnexfileDatabaseConfig } from './lib/config/knexfile.js'

dotenvFlow.config()

// The project is ESM-only ("type": "module"), so migrations are authored as
// native ES modules (named `up`/`down` exports). Point `migrate:make` at the
// ESM stub so generated migrations match.
const migrations = { stub: 'migration.stub' }

const withMigrations = () => ({ ...getKnexfileDatabaseConfig(), migrations })

const config = {
  development: withMigrations(),
  production: withMigrations(),
  staging: withMigrations()
}

export default config
