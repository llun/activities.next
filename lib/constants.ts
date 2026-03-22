import 'server-only'

import packageJson from '@/package.json'

export const ACTIVITIES_HOST = 'x-activity-next-host'
export const FORWARDED_HOST = 'x-forwarded-host'

export const VERSION = packageJson.version
export const SERVICE_NAME = 'activities.next'
export const NODE_SOFTWARE = {
  name: SERVICE_NAME,
  version: VERSION
}

export const DEFAULT_OAUTH_TOKEN_LENGTH = 192
