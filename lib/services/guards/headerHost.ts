import { IncomingHttpHeaders } from 'http'

import { type Config, getConfig } from '@/lib/config'
import { ACTIVITIES_HOST, FORWARDED_HOST } from '@/lib/constants'
import {
  getConfiguredHost,
  getTrustedHostRules,
  isHostTrustedByRules,
  normalizeHost
} from '@/lib/utils/host'

type NextAuthHeaders = Record<string, any> | undefined // eslint-disable-line @typescript-eslint/no-explicit-any

type HostConfig = Pick<Config, 'host' | 'allowActorDomains'> & {
  trustedHosts?: string[]
}

const ACTIVITIES_HOST_HEADER = ACTIVITIES_HOST.toLowerCase()
const FORWARDED_HOST_HEADER = FORWARDED_HOST.toLowerCase()

const getFirstHeaderValue = (value: string | string[] | undefined | null) => {
  if (Array.isArray(value)) return value[0]
  return value
}

export const isTrustedHeaderHost = (
  host: string | undefined | null,
  config: HostConfig = getConfig()
) => isHostTrustedByRules(host, getTrustedHostRules(config))

export function headerHost(
  headers: IncomingHttpHeaders | Headers | NextAuthHeaders
): string {
  const config = getConfig()
  const configuredHost = getConfiguredHost(config.host)
  if (!headers) return configuredHost

  if (headers.constructor.name === Headers.name) {
    const standardHeaders = headers as Headers
    const activityHost = standardHeaders.get(ACTIVITIES_HOST)
    if (activityHost) {
      return isTrustedHeaderHost(activityHost, config)
        ? (normalizeHost(activityHost) as string)
        : configuredHost
    }

    const forwardedHost = standardHeaders.get(FORWARDED_HOST)
    if (forwardedHost) {
      return isTrustedHeaderHost(forwardedHost, config)
        ? (normalizeHost(forwardedHost) as string)
        : configuredHost
    }

    const host = normalizeHost(standardHeaders.get('host'))
    if (host) {
      return isTrustedHeaderHost(host, config) ? host : configuredHost
    }

    return configuredHost
  }

  const nodeHeaders = headers as IncomingHttpHeaders
  const normalizedHeaders = Object.keys(nodeHeaders).reduce(
    (out, key) => ({ ...out, [key.toLowerCase()]: nodeHeaders[key] }),
    {} as IncomingHttpHeaders
  )

  if (normalizedHeaders[ACTIVITIES_HOST_HEADER]) {
    const value = getFirstHeaderValue(normalizedHeaders[ACTIVITIES_HOST_HEADER])
    return isTrustedHeaderHost(value, config)
      ? (normalizeHost(value) as string)
      : configuredHost
  }

  if (normalizedHeaders[FORWARDED_HOST_HEADER]) {
    const value = getFirstHeaderValue(normalizedHeaders[FORWARDED_HOST_HEADER])
    return isTrustedHeaderHost(value, config)
      ? (normalizeHost(value) as string)
      : configuredHost
  }

  const host = normalizeHost(getFirstHeaderValue(normalizedHeaders.host))
  if (host) {
    return isTrustedHeaderHost(host, config) ? host : configuredHost
  }

  return configuredHost
}
