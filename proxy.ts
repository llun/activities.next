import { NextRequest, NextResponse } from 'next/server'

import { ACTIVITIES_HOST, FORWARDED_HOST } from '@/lib/constants'
import { acceptContainsContentTypes } from '@/lib/utils/acceptContainsContentTypes'

export const config = {
  matcher: ['/(@.*)']
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

const getEnvironmentList = (key: string): string[] => {
  try {
    const parsed = JSON.parse(process.env[key] || '[]')
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : []
  } catch {
    return []
  }
}

const getConfiguredHost = () =>
  normalizeHost(process.env.ACTIVITIES_HOST) ??
  process.env.ACTIVITIES_HOST ??
  ''

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

const isTrustedHeaderHost = (host: string | undefined | null) => {
  const normalizedHost = normalizeHost(host)
  if (!normalizedHost) return false

  return [
    process.env.ACTIVITIES_HOST ?? '',
    ...getEnvironmentList('ACTIVITIES_ALLOW_ACTOR_DOMAINS'),
    ...getEnvironmentList('ACTIVITIES_TRUSTED_HOSTS')
  ].some((rule) => hostMatchesRule(normalizedHost, rule))
}

const proxyHeaderHost = (headers: Headers): string => {
  const configuredHost = getConfiguredHost()

  const activityHost = headers.get(ACTIVITIES_HOST)
  if (activityHost) {
    return isTrustedHeaderHost(activityHost)
      ? (normalizeHost(activityHost) as string)
      : configuredHost
  }

  const forwardedHost = headers.get(FORWARDED_HOST)
  if (forwardedHost) {
    return isTrustedHeaderHost(forwardedHost)
      ? (normalizeHost(forwardedHost) as string)
      : configuredHost
  }

  const host = normalizeHost(headers.get('host'))
  if (host) {
    return isTrustedHeaderHost(host) ? host : configuredHost
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
