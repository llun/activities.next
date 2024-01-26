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

    if (standardHeaders.get('host')) {
      return standardHeaders.get('host') as string
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

  if (normalizedHeaders.host) {
    return normalizedHeaders.host
  }

  return config.host
}
