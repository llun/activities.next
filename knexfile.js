import dotenvFlow from 'dotenv-flow'

import { getKnexfileDatabaseConfig } from './lib/config/knexfile.js'

dotenvFlow.config()

const config = {
  development: getKnexfileDatabaseConfig(),
  production: getKnexfileDatabaseConfig(),
  staging: getKnexfileDatabaseConfig()
}

export default config
