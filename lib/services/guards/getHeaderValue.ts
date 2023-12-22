import { IncomingHttpHeaders } from 'http'

export const getHeadersValue = (
  headers: IncomingHttpHeaders | Headers,
  key: string
) => {
  if (headers.constructor.name === Headers.name) {
    const standardHeaders = headers as Headers
    return standardHeaders.get(key)
  }

  const nodeHeaders = headers as IncomingHttpHeaders
  return nodeHeaders[key]
}
