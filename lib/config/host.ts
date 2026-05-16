import { type EnvironmentListOptions, getEnvironmentList } from './utils'

export type HostConfig = {
  host: string
  trustedHosts: string[]
}

export type AppHostConfig = HostConfig & {
  allowActorDomains: string[]
}

let cachedHostConfig: AppHostConfig | null = null
let cachedProxyHostConfig: HostConfig | null = null

export const getHostConfigFromEnvironment = (
  options?: EnvironmentListOptions
): AppHostConfig => ({
  host: process.env.ACTIVITIES_HOST || '',
  allowActorDomains: getEnvironmentList(
    'ACTIVITIES_ALLOW_ACTOR_DOMAINS',
    options
  ),
  trustedHosts: getEnvironmentList('ACTIVITIES_TRUSTED_HOSTS', options)
})

const getProxyHostConfigFromEnvironment = (): HostConfig => ({
  host: process.env.ACTIVITIES_HOST || '',
  trustedHosts: getEnvironmentList('ACTIVITIES_TRUSTED_HOSTS')
})

export const getHostConfig = (): AppHostConfig => {
  if (cachedHostConfig) return cachedHostConfig

  cachedHostConfig = getHostConfigFromEnvironment()
  return cachedHostConfig
}

export const getProxyHostConfig = (): HostConfig => {
  if (cachedProxyHostConfig) return cachedProxyHostConfig

  cachedProxyHostConfig = getProxyHostConfigFromEnvironment()
  return cachedProxyHostConfig
}

export const resetHostConfigCacheForTests = () => {
  cachedHostConfig = null
  cachedProxyHostConfig = null
}
