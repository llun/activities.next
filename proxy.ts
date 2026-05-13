import { NextRequest, NextResponse } from 'next/server'

import { ACTIVITIES_HOST, FORWARDED_HOST } from '@/lib/constants'
import { acceptContainsContentTypes } from '@/lib/utils/acceptContainsContentTypes'
import {
  getConfiguredHost,
  getTrustedHostRules,
  isHostTrustedByRules,
  normalizeHost
} from '@/lib/utils/host'

export const config = {
  matcher: ['/(@.*)']
}

type ProxyHostConfig = {
  host: string
  allowActorDomains: string[]
  trustedHosts: string[]
}

const getEnvironmentList = (key: string): string[] => {
  try {
    const parsed = JSON.parse(process.env[key] || '[]')
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : []
  } catch {
    return []
  }
}

const getProxyHostConfig = (): ProxyHostConfig => {
  return {
    host: process.env.ACTIVITIES_HOST ?? '',
    allowActorDomains: getEnvironmentList('ACTIVITIES_ALLOW_ACTOR_DOMAINS'),
    trustedHosts: getEnvironmentList('ACTIVITIES_TRUSTED_HOSTS')
  }
}

const isTrustedHeaderHost = (
  host: string | undefined | null,
  config: ProxyHostConfig
) => isHostTrustedByRules(host, getTrustedHostRules(config))

const proxyHeaderHost = (headers: Headers): string => {
  const config = getProxyHostConfig()
  const configuredHost = getConfiguredHost(config.host)

  const activityHost = headers.get(ACTIVITIES_HOST)
  if (activityHost) {
    return isTrustedHeaderHost(activityHost, config)
      ? (normalizeHost(activityHost) as string)
      : configuredHost
  }

  const forwardedHost = headers.get(FORWARDED_HOST)
  if (forwardedHost) {
    return isTrustedHeaderHost(forwardedHost, config)
      ? (normalizeHost(forwardedHost) as string)
      : configuredHost
  }

  const host = normalizeHost(headers.get('host'))
  if (host) {
    return isTrustedHeaderHost(host, config) ? host : configuredHost
  }

  return configuredHost
}

export async function proxy(request: NextRequest) {
  if (request.method === 'GET') {
    const pathname = request.nextUrl.pathname
    const acceptValue = request.headers.get('Accept')

    if (
      acceptValue &&
      acceptContainsContentTypes(acceptValue, [
        'application/activity+json',
        'application/ld+json',
        'application/json'
      ])
    ) {
      // Actor route
      if (/^\/@\w+$/.test(pathname)) {
        const matches = pathname.match(/^\/@(?<username>\w+)/)
        const apiUrl = request.nextUrl.clone()
        apiUrl.pathname = `/api/users/${matches?.groups?.username}`
        return NextResponse.rewrite(apiUrl)
      }

      // Actor status route
      if (/^\/@\w+\/[\w-]+$/.test(pathname) && acceptValue) {
        const matches = pathname.match(
          /^\/@(?<username>\w+)\/(?<statusId>[\w-]+)/
        )
        const apiUrl = request.nextUrl.clone()
        apiUrl.pathname = `/api/users/${matches?.groups?.username}/statuses/${matches?.groups?.statusId}`
        return NextResponse.rewrite(apiUrl)
      }
    }

    // Redirect actor with no host
    if (request.nextUrl.pathname.startsWith('/@')) {
      const pathname = request.nextUrl.pathname
      const totalAt = pathname
        .split('')
        .reduce((count, char) => (char === '@' ? count + 1 : count), 0)
      if (totalAt === 2) return NextResponse.next()

      const host = proxyHeaderHost(request.headers) || request.nextUrl.host
      const pathItems = pathname.split('/').slice(1)
      pathItems[0] = `${pathItems[0]}@${host}`

      const cloneUrl = request.nextUrl.clone()
      cloneUrl.pathname = `/${pathItems.join('/')}`
      return NextResponse.rewrite(cloneUrl)
    }

    return NextResponse.next()
  }
}
