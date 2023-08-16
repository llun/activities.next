import fs from 'fs'

import { Config } from './lib/config'

const sharedConfig = JSON.parse(
  fs.readFileSync('./config.json', 'utf-8')
) as Config

if (!['knex', 'sqlite3', 'sql'].includes(sharedConfig.database.type)) {
  console.error('Unsupported database type')
  process.exit(0)
}

const config = {
  development: sharedConfig.database
}

module.exports = config
