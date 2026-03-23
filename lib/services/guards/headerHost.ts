import { IncomingHttpHeaders } from 'http'

import { getConfig } from '@/lib/config'
import { ACTIVITIES_HOST, FORWARDED_HOST } from '@/lib/constants'

type NextAuthHeaders = Record<string, any> | undefined // eslint-disable-line @typescript-eslint/no-explicit-any

export function headerHost(
  headers: IncomingHttpHeaders | Headers | NextAuthHeaders
): string {
  const config = getConfig()
  if (!headers) return config.host

  if (headers.constructor.name === Headers.name) {
    const standardHeaders = headers as Headers
    if (standardHeaders.get(ACTIVITIES_HOST)) {
      return standardHeaders.get(ACTIVITIES_HOST) as string
    }
    if (standardHeaders.get(FORWARDED_HOST)) {
      return standardHeaders.get(FORWARDED_HOST) as string
    }

    const host = standardHeaders.get('host')
    if (host && !host.startsWith('0.0.0.0')) {
      return host
    }

    return config.host
  }

  const nodeHeaders = headers as IncomingHttpHeaders
  const normalizedHeaders = Object.keys(nodeHeaders).reduce(
    (out, key) => ({ ...out, [key.toLowerCase()]: nodeHeaders[key] }),
    {} as IncomingHttpHeaders
  )

  if (normalizedHeaders[ACTIVITIES_HOST]) {
    const value = normalizedHeaders[ACTIVITIES_HOST]
    return Array.isArray(value) ? value[0] : value
  }

  if (normalizedHeaders[FORWARDED_HOST]) {
    const value = normalizedHeaders[FORWARDED_HOST]
    return Array.isArray(value) ? value[0] : value
  }

  const host = normalizedHeaders.host
  if (host && !(Array.isArray(host) ? host[0] : host).startsWith('0.0.0.0')) {
    return Array.isArray(host) ? host[0] : host
  }

  return config.host
}
