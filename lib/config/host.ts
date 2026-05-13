import fs from 'fs'
import path from 'path'

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

const getFileProxyHostConfig = (): HostConfig | null => {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
    )
    if (!isRecord(parsed)) {
      return null
    }

    const hasHostConfig =
      typeof parsed.host === 'string' ||
      Array.isArray(parsed.allowActorDomains) ||
      Array.isArray(parsed.trustedHosts)
    if (!hasHostConfig) return null

    return {
      host: typeof parsed.host === 'string' ? parsed.host : '',
      allowActorDomains: toStringList(
        parsed.allowActorDomains,
        'allowActorDomains'
      ),
      trustedHosts: toStringList(parsed.trustedHosts, 'trustedHosts')
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
    getFileProxyHostConfig() ?? getHostConfigFromEnvironment()
  return cachedProxyHostConfig
}

export const resetHostConfigCacheForTests = () => {
  cachedHostConfig = null
  cachedProxyHostConfig = null
}
