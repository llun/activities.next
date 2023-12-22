import { IncomingHttpHeaders } from 'http'

import { getConfig } from '@/lib/config'
import { ACTIVITIES_HOST, FORWARDED_HOST } from '@/lib/constants'

export function headerHost(headers: IncomingHttpHeaders | Headers) {
  const config = getConfig()

  if (headers.constructor.name === Headers.name) {
    const standardHeaders = headers as Headers
    if (standardHeaders.get(ACTIVITIES_HOST)) {
      return standardHeaders.get(ACTIVITIES_HOST)
    }
    if (standardHeaders.get(FORWARDED_HOST)) {
      return standardHeaders.get(FORWARDED_HOST)
    }

    if (standardHeaders.get('host')) {
      return standardHeaders.get('host')
    }

    return config.host
  }

  const nodeHeaders = headers as IncomingHttpHeaders
  const normalizedHeaders = Object.keys(nodeHeaders).reduce(
    (out, key) => ({ ...out, [key.toLowerCase()]: nodeHeaders[key] }),
    {} as IncomingHttpHeaders
  )

  if (normalizedHeaders[ACTIVITIES_HOST]) {
    return normalizedHeaders[ACTIVITIES_HOST]
  }

  if (normalizedHeaders[FORWARDED_HOST]) {
    return normalizedHeaders[FORWARDED_HOST]
  }

  if (normalizedHeaders.host) {
    return normalizedHeaders.host
  }

  return config.host
}
