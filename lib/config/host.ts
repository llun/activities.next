export type HostConfig = {
  host: string
  trustedHosts: string[]
}

export type AppHostConfig = HostConfig & {
  allowActorDomains: string[]
}

type EnvironmentListOptions = {
  onInvalidList?: 'empty' | 'throw'
}

let cachedHostConfig: AppHostConfig | null = null
let cachedProxyHostConfig: HostConfig | null = null

const toStringList = (
  value: unknown,
  key: string,
  { onInvalidList = 'empty' }: EnvironmentListOptions = {}
): string[] => {
  if (Array.isArray(value)) return value.filter(Boolean).map(String)

  if (onInvalidList === 'throw') {
    throw new Error(`${key} must be a JSON array`)
  }

  return []
}

const getEnvironmentList = (
  key: string,
  { onInvalidList = 'empty' }: EnvironmentListOptions = {}
): string[] => {
  try {
    return toStringList(JSON.parse(process.env[key] || '[]'), key, {
      onInvalidList
    })
  } catch (error) {
    if (onInvalidList === 'throw') throw error
    return []
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const getInjectedProxyHostConfig = (): HostConfig | null => {
  try {
    const parsed = JSON.parse(
      process.env.ACTIVITIES_PROXY_HOST_CONFIG || 'null'
    )
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
  } catch {
    return null
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
    : (getInjectedProxyHostConfig() ?? getProxyHostConfigFromEnvironment())
  return cachedProxyHostConfig
}

export const resetHostConfigCacheForTests = () => {
  cachedHostConfig = null
  cachedProxyHostConfig = null
}
