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
  const listed = entries.findIndex((entry) => entry.includes(','))
  if (listed === -1) return entries
  if (options?.onInvalidList === 'throw') {
    // The index, not the entry: a mistyped entry may hold a pasted credential.
    throw new Error(
      `ACTIVITIES_TRUSTED_HOSTS: each entry must be one host; entry ${listed} holds a comma, so split it into separate JSON array entries`
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
