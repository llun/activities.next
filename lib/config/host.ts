export type HostConfig = {
  host: string
  allowActorDomains: string[]
  trustedHosts: string[]
}

type EnvironmentListOptions = {
  onInvalidList?: 'empty' | 'throw'
}

let cachedHostConfig: HostConfig | null = null
let cachedProxyHostConfig: HostConfig | null = null

const PROXY_HOST_CONFIG = 'ACTIVITIES_PROXY_HOST_CONFIG'

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

const getInjectedProxyHostConfig = (): HostConfig | null => {
  try {
    const parsed = JSON.parse(process.env[PROXY_HOST_CONFIG] || 'null')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    const config = parsed as Partial<HostConfig>
    return {
      host: typeof config.host === 'string' ? config.host : '',
      allowActorDomains: toStringList(
        config.allowActorDomains,
        'allowActorDomains'
      ),
      trustedHosts: toStringList(config.trustedHosts, 'trustedHosts')
    }
  } catch {
    return null
  }
}

export const getHostConfigFromEnvironment = (
  options?: EnvironmentListOptions
): HostConfig => ({
  host: process.env.ACTIVITIES_HOST || '',
  allowActorDomains: getEnvironmentList(
    'ACTIVITIES_ALLOW_ACTOR_DOMAINS',
    options
  ),
  trustedHosts: getEnvironmentList('ACTIVITIES_TRUSTED_HOSTS', options)
})

export const getHostConfig = (): HostConfig => {
  if (cachedHostConfig) return cachedHostConfig

  cachedHostConfig = getHostConfigFromEnvironment()
  return cachedHostConfig
}

export const getProxyHostConfig = (): HostConfig => {
  if (cachedProxyHostConfig) return cachedProxyHostConfig

  cachedProxyHostConfig =
    getInjectedProxyHostConfig() ?? getHostConfigFromEnvironment()
  return cachedProxyHostConfig
}

export const resetHostConfigCacheForTests = () => {
  cachedHostConfig = null
  cachedProxyHostConfig = null
}
