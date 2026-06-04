import { SERVICE_NAME } from '@/lib/constants'
import packageJson from '@/package.json'

export const VERSION = packageJson.version

/**
 * NodeInfo requires `software.name` to match `^[a-z0-9-]+$`. `SERVICE_NAME`
 * contains a dot (`activities.next`), so derive a schema-safe slug from it.
 */
export const NODE_INFO_SOFTWARE_NAME = SERVICE_NAME.toLowerCase().replace(
  /[^a-z0-9-]+/g,
  '-'
)
