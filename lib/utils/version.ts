import packageJson from '@/package.json'

import { SERVICE_NAME } from '@/lib/constants'

export const VERSION = packageJson.version
export const NODE_SOFTWARE = {
  name: SERVICE_NAME,
  version: VERSION,
}
