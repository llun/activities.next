import { readRuntimeConfigFile } from './runtimeConfigFile'
import {
  type EnvironmentListOptions,
  getEnvironmentList,
  isRecord,
  toStringList
} from './utils'

export type HostConfig = {
  host: string
  trustedHosts: string[]
}

export type AppHostConfig = HostConfig & {
  allowActorDomains: string[]
}

let cachedHostConfig: AppHostConfig | null = null
let cachedProxyHostConfig: HostConfig | null = null

const getFileProxyHostConfig = (): HostConfig | null => {
  const parsed = readRuntimeConfigFile()
  if (!isRecord(parsed)) {
    return null
  }

  const hasHostConfig =
    typeof parsed.host === 'string' || Array.isArray(parsed.trustedHosts)
  if (!hasHostConfig) return null

  return {
    host: typeof parsed.host === 'string' ? parsed.host : '',
    trustedHosts: toStringList(parsed.trustedHosts, 'trustedHosts')
  }
}

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

const getProxyHostConfigFromEnvironment = (
  options?: EnvironmentListOptions
): HostConfig => ({
  host: process.env.ACTIVITIES_HOST || '',
  trustedHosts: getEnvironmentList('ACTIVITIES_TRUSTED_HOSTS', options)
})

const hasRuntimeProxyHostConfig = () =>
  process.env.ACTIVITIES_HOST !== undefined ||
  process.env.ACTIVITIES_TRUSTED_HOSTS !== undefined

export const getHostConfig = (): AppHostConfig => {
  if (cachedHostConfig) return cachedHostConfig

  cachedHostConfig = getHostConfigFromEnvironment()
  return cachedHostConfig
}

export const getProxyHostConfig = (): HostConfig => {
  if (cachedProxyHostConfig) return cachedProxyHostConfig

  cachedProxyHostConfig = hasRuntimeProxyHostConfig()
    ? getProxyHostConfigFromEnvironment()
    : (getFileProxyHostConfig() ?? getProxyHostConfigFromEnvironment())
  return cachedProxyHostConfig
}

export const resetHostConfigCacheForTests = () => {
  cachedHostConfig = null
  cachedProxyHostConfig = null
}
