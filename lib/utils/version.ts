import { SERVICE_NAME } from '@/lib/constants'
import packageJson from '@/package.json'

export const VERSION = packageJson.version
export const NODE_SOFTWARE = {
  name: SERVICE_NAME,
  version: VERSION
}
