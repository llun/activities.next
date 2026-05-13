import { IncomingHttpHeaders } from 'http'

import { type Config, getConfig } from '@/lib/config'
import { ACTIVITIES_HOST, FORWARDED_HOST } from '@/lib/constants'

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

const normalizeHost = (value: string | undefined | null): string | null => {
  const firstHost = value?.split(',')[0]?.trim()
  if (!firstHost || firstHost.startsWith('0.0.0.0')) return null
  const hasWildcard = firstHost.startsWith('*.')
  const hostToParse = hasWildcard ? firstHost.slice(2) : firstHost

  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(hostToParse)
        ? hostToParse
        : `https://${hostToParse}`
    )
    const normalizedHost = url.host.toLowerCase().replace(/\.$/, '')
    return hasWildcard ? `*.${normalizedHost}` : normalizedHost
  } catch {
    return null
  }
}

const getConfiguredHost = (config: HostConfig) =>
  normalizeHost(config.host) ?? config.host ?? ''

const hostMatchesRule = (host: string, rule: string) => {
  const normalizedRule = normalizeHost(rule)
  if (!normalizedRule) return false
  if (host === normalizedRule) return true

  if (normalizedRule.startsWith('*.')) {
    const parent = normalizedRule.slice(2)
    const hostname = host.split(':')[0]
    return hostname.endsWith(`.${parent}`)
  }

  return false
}

export const isTrustedHeaderHost = (
  host: string | undefined | null,
  config: HostConfig = getConfig()
) => {
  const normalizedHost = normalizeHost(host)
  if (!normalizedHost) return false

  return [
    config.host,
    ...(config.allowActorDomains ?? []),
    ...(config.trustedHosts ?? [])
  ].some((rule) => hostMatchesRule(normalizedHost, rule))
}

export function headerHost(
  headers: IncomingHttpHeaders | Headers | NextAuthHeaders
): string {
  const config = getConfig()
  const configuredHost = getConfiguredHost(config)
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
