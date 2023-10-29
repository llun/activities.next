import dotenvFlow from 'dotenv-flow'

import { getConfig } from './lib/config'

dotenvFlow.config()
if (!['knex', 'sqlite3', 'sql'].includes(getConfig().database.type)) {
  console.error('Unsupported database type')
  process.exit(0)
}

const config = {
  development: getConfig().database
}

module.exports = config
