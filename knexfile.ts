import type { Knex } from 'knex'

import sharedConfig from './lib/config'

const config: { [key: string]: Knex.Config } = {
  development: sharedConfig.database
}

module.exports = config
