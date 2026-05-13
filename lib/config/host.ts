import fs from 'fs'
import path from 'path'

export type HostConfig = {
  host: string
  allowActorDomains: string[]
  trustedHosts: string[]
}

type HostFileConfig = {
  host?: unknown
  allowActorDomains?: unknown
  trustedHosts?: unknown
}

type EnvironmentListOptions = {
  onInvalidList?: 'empty' | 'throw'
}

let cachedHostConfig: HostConfig | null = null

const toStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(Boolean).map(String) : []

const getEnvironmentList = (
  key: string,
  { onInvalidList = 'empty' }: EnvironmentListOptions = {}
): string[] => {
  try {
    return toStringList(JSON.parse(process.env[key] || '[]'))
  } catch (error) {
    if (onInvalidList === 'throw') throw error
    return []
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

export const getHostConfigFromFile = (): HostConfig | null => {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
    ) as HostFileConfig

    if (!parsed || typeof parsed !== 'object') return null

    return {
      host: typeof parsed.host === 'string' ? parsed.host : '',
      allowActorDomains: toStringList(parsed.allowActorDomains),
      trustedHosts: toStringList(parsed.trustedHosts)
    }
  } catch {
    return null
  }
}

export const getHostConfig = (): HostConfig => {
  if (cachedHostConfig) return cachedHostConfig

  cachedHostConfig = getHostConfigFromFile() ?? getHostConfigFromEnvironment()
  return cachedHostConfig
}

export const resetHostConfigCacheForTests = () => {
  cachedHostConfig = null
}
