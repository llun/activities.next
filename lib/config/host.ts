import { type EnvironmentListOptions, getEnvironmentList } from './utils'

export type HostConfig = {
  host: string
  trustedHosts: string[]
}

export type AppHostConfig = HostConfig & {
  allowActorDomains: string[]
}

let cachedProxyHostConfig: HostConfig | null = null

// One host per entry. A URL parser keeps `,` in a hostname, so the host rules
// would read `a.example,b.example` as `a.example` alone and trust only that,
// without a word. The app's config load refuses it; the proxy, which only
// reads the list, drops the entry instead of guessing.
const getTrustedHostsFromEnvironment = (options?: EnvironmentListOptions) => {
  const entries = getEnvironmentList('ACTIVITIES_TRUSTED_HOSTS', options)
  if (!entries.some((entry) => entry.includes(','))) return entries
  if (options?.onInvalidList === 'throw') {
    // Neither the entry (it may hold a pasted credential) nor its position
    // (empty entries are dropped before this, so it would be miscounted).
    throw new Error(
      'ACTIVITIES_TRUSTED_HOSTS: each entry must be one host; split the entry that holds a comma into separate JSON array entries'
    )
  }
  return entries.filter((entry) => !entry.includes(','))
}

export const getHostConfigFromEnvironment = (
  options?: EnvironmentListOptions
): AppHostConfig => ({
  host: process.env.ACTIVITIES_HOST || '',
  allowActorDomains: getEnvironmentList(
    'ACTIVITIES_ALLOW_ACTOR_DOMAINS',
    options
  ),
  trustedHosts: getTrustedHostsFromEnvironment(options)
})

export const getProxyHostConfig = (): HostConfig => {
  if (cachedProxyHostConfig) return cachedProxyHostConfig

  cachedProxyHostConfig = {
    host: process.env.ACTIVITIES_HOST || '',
    trustedHosts: getTrustedHostsFromEnvironment()
  }
  return cachedProxyHostConfig
}

export const resetHostConfigCacheForTests = () => {
  cachedProxyHostConfig = null
}
