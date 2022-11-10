import type { Knex } from 'knex'
import fs from 'fs'

import { Config } from './lib/config'

const sharedConfig = JSON.parse(
  fs.readFileSync('./config.json', 'utf-8')
) as Config
const config: { [key: string]: Knex.Config } = {
  development: sharedConfig.database
}

module.exports = config
