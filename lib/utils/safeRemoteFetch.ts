import got, { Headers, Method, OptionsInit } from 'got'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { PassThrough, type Readable } from 'node:stream'

export const DEFAULT_SAFE_REMOTE_FETCH_MAX_BODY_BYTES = 2 * 1024 * 1024
export const DEFAULT_SAFE_REMOTE_FETCH_MAX_REDIRECTS = 3

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308])
const SENSITIVE_REDIRECT_HEADERS = new Set([
  'authorization',
  'cookie',
  'cookie2',
  'proxy-authorization',
  'signature'
])
const BODY_REDIRECT_HEADERS = new Set([
  'content-digest',
  'content-encoding',
  'content-language',
  'content-length',
  'content-location',
  'content-type',
  'digest',
  'signature'
])
const DYNAMIC_BODY_REDIRECT_HEADERS = new Set([
  'content-digest',
  'content-encoding',
  'content-language',
  'content-length',
  'content-location',
  'content-type',
  'digest'
])
const RETRY_DISABLED = { limit: 0 }

export type SafeRemoteFetchMethod = Method
export type SafeRemoteFetchHeaders = Headers
export type SafeRemoteFetchHeaderBuilderRequest = {
  body?: string
  method: SafeRemoteFetchMethod
  url: URL
}
export type SafeRemoteFetchHeaderBuilder = (
  request: SafeRemoteFetchHeaderBuilderRequest
) => SafeRemoteFetchHeaders
export type SafeRemoteFetchHeaderSource =
  | SafeRemoteFetchHeaders
  | SafeRemoteFetchHeaderBuilder

export type ResolvedRemoteAddress = {
  address: string
  family: 4 | 6
}

export type SafeRemoteFetchTransportRequest = {
  body?: string
  connectTimeoutInMilliseconds: number
  headers: SafeRemoteFetchHeaders
  method: SafeRemoteFetchMethod
  readTimeoutInMilliseconds: number
  resolvedAddress: ResolvedRemoteAddress
  resolvedAddresses: ResolvedRemoteAddress[]
  url: URL
}

export type SafeRemoteFetchTransportResponse = {
  body: Readable
  headers: Record<string, string | string[] | undefined>
  statusCode: number
}

export type SafeRemoteFetchTransport = (
  request: SafeRemoteFetchTransportRequest
) => Promise<SafeRemoteFetchTransportResponse>

export type SafeRemoteFetchOptions = {
  body?: string
  connectTimeoutInMilliseconds?: number
  headers?: SafeRemoteFetchHeaderSource
  maxBodyBytes?: number
  maxRedirects?: number
  method?: SafeRemoteFetchMethod
  readTimeoutInMilliseconds?: number
  timeoutInMilliseconds?: number
  url: string
}

export type SafeRemoteFetchResult = {
  body: string
  headers: Record<string, string | string[] | undefined>
  statusCode: number
  url: string
}

type ResolveHost = (hostname: string) => Promise<ResolvedRemoteAddress[]>

export class SafeRemoteFetchError extends Error {
  code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'SafeRemoteFetchError'
    this.code = code
  }
}

const createUnsafeUrlError = (message: string) =>
  new SafeRemoteFetchError(message, 'ERR_UNSAFE_REMOTE_URL')

const createResponseTooLargeError = () =>
  new SafeRemoteFetchError('Response body too large', 'ERR_RESPONSE_TOO_LARGE')

const stripIpv6Brackets = (hostname: string) =>
  hostname.replace(/^\[/, '').replace(/\]$/, '')

const normalizeHostname = (hostname: string) =>
  stripIpv6Brackets(hostname).toLowerCase()

const parseIpv4Bytes = (address: string) => {
  const bytes = address.split('.').map((part) => Number(part))
  if (
    bytes.length !== 4 ||
    bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    return null
  }

  return bytes
}

const isUnsafeIpv4 = (address: string) => {
  const bytes = parseIpv4Bytes(address)
  if (!bytes) return true

  const [first, second, third, fourth] = bytes

  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224 ||
    (first === 255 && second === 255 && third === 255 && fourth === 255)
  )
}

const isIpv4Loopback = (address: string) => parseIpv4Bytes(address)?.[0] === 127

const ipv4ToIpv6Groups = (address: string) => {
  const bytes = parseIpv4Bytes(address)
  if (!bytes) return null

  return [
    ((bytes[0] ?? 0) << 8) + (bytes[1] ?? 0),
    ((bytes[2] ?? 0) << 8) + (bytes[3] ?? 0)
  ]
}

const parseIpv6Bytes = (address: string) => {
  const normalizedAddress = normalizeHostname(address).split('%')[0] ?? ''
  const ipv4Match = normalizedAddress.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)
  const ipv4Groups = ipv4Match ? ipv4ToIpv6Groups(ipv4Match[1] ?? '') : null
  if (ipv4Match && !ipv4Groups) return null

  const addressWithoutIpv4 =
    ipv4Match && ipv4Groups
      ? `${normalizedAddress.slice(0, ipv4Match.index)}:${ipv4Groups
          .map((group) => group.toString(16))
          .join(':')}`
      : normalizedAddress
  const sections = addressWithoutIpv4.split('::')
  if (sections.length > 2) return null

  const parseGroups = (value: string) => {
    if (!value) return []
    return value.split(':').map((group) => {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null
      return parseInt(group, 16)
    })
  }

  const head = parseGroups(sections[0] ?? '')
  const tail = parseGroups(sections[1] ?? '')
  if (head.includes(null) || tail.includes(null)) return null

  const missingGroupCount = 8 - head.length - tail.length
  if (sections.length === 1 && missingGroupCount !== 0) return null
  if (sections.length === 2 && missingGroupCount < 1) return null

  const groups = [
    ...(head as number[]),
    ...Array.from({ length: missingGroupCount }, () => 0),
    ...(tail as number[])
  ]
  if (groups.length !== 8) return null

  return groups.flatMap((group) => [group >> 8, group & 0xff])
}

const isIpv4MappedIpv6 = (bytes: number[]) =>
  bytes.slice(0, 10).every((byte) => byte === 0) &&
  bytes[10] === 0xff &&
  bytes[11] === 0xff

const hasIpv4CompatibleIpv6Tail = (bytes: number[]) =>
  bytes.slice(0, 12).every((byte) => byte === 0) &&
  bytes.slice(12).some((byte) => byte !== 0)

const isWellKnownNat64Ipv6 = (bytes: number[]) =>
  bytes[0] === 0x00 &&
  bytes[1] === 0x64 &&
  bytes[2] === 0xff &&
  bytes[3] === 0x9b &&
  bytes.slice(4, 12).every((byte) => byte === 0)

const isRfc8215LocalUseNat64Ipv6 = (bytes: number[]) =>
  bytes[0] === 0x00 &&
  bytes[1] === 0x64 &&
  bytes[2] === 0xff &&
  bytes[3] === 0x9b &&
  bytes[4] === 0x00 &&
  bytes[5] === 0x01

const getIpv4Tail = (bytes: number[]) => bytes.slice(12).join('.')

const getPrefix48EmbeddedIpv4 = (bytes: number[]) =>
  [bytes[6], bytes[7], bytes[9], bytes[10]].join('.')

const isUnsafeIpv6 = (address: string) => {
  const bytes = parseIpv6Bytes(address)
  if (!bytes) return true

  if (
    isIpv4MappedIpv6(bytes) ||
    hasIpv4CompatibleIpv6Tail(bytes) ||
    isWellKnownNat64Ipv6(bytes)
  ) {
    return isUnsafeIpv4(getIpv4Tail(bytes))
  }
  if (isRfc8215LocalUseNat64Ipv6(bytes)) {
    return isUnsafeIpv4(getPrefix48EmbeddedIpv4(bytes))
  }

  const isUnspecified = bytes.every((byte) => byte === 0)
  const isLoopback =
    bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1
  const isDiscard =
    bytes[0] === 0x01 &&
    bytes[1] === 0x00 &&
    bytes.slice(2, 8).every((byte) => byte === 0)
  const isTeredo =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x00 &&
    bytes[3] === 0x00
  const isDeprecatedOrchid =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x00 &&
    (bytes[3] & 0xf0) === 0x10
  const isOrchidV2 =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x00 &&
    (bytes[3] & 0xf0) === 0x20
  const is6to4 = bytes[0] === 0x20 && bytes[1] === 0x02
  const isDocumentation =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8
  const isUniqueLocal = (bytes[0] & 0xfe) === 0xfc
  const isLinkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80
  const isMulticast = bytes[0] === 0xff

  return (
    isUnspecified ||
    isLoopback ||
    isDiscard ||
    isTeredo ||
    isDeprecatedOrchid ||
    isOrchidV2 ||
    is6to4 ||
    isDocumentation ||
    isUniqueLocal ||
    isLinkLocal ||
    isMulticast
  )
}

const isIpv6Loopback = (address: string) => {
  const bytes = parseIpv6Bytes(address)
  return (
    !!bytes && bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1
  )
}

const isUnsafeAddress = (address: string) => {
  const normalizedAddress = normalizeHostname(address)
  const ipVersion = net.isIP(normalizedAddress)
  if (ipVersion === 4) return isUnsafeIpv4(normalizedAddress)
  if (ipVersion === 6) return isUnsafeIpv6(normalizedAddress)

  return true
}

const isLoopbackAddress = (address: string) => {
  const normalizedAddress = normalizeHostname(address)
  const ipVersion = net.isIP(normalizedAddress)
  if (ipVersion === 4) return isIpv4Loopback(normalizedAddress)
  if (ipVersion === 6) return isIpv6Loopback(normalizedAddress)

  return false
}

const isLocalhostHostname = (hostname: string) => {
  const normalizedHostname = normalizeHostname(hostname)
  if (normalizedHostname === 'localhost') return true

  return isLoopbackAddress(normalizedHostname)
}

const allowsDevelopmentLocalhost = (url: URL) =>
  process.env.NODE_ENV === 'development' && isLocalhostHostname(url.hostname)

const assertAllowedProtocol = (url: URL) => {
  if (url.protocol === 'https:') return
  if (url.protocol === 'http:' && allowsDevelopmentLocalhost(url)) return

  throw createUnsafeUrlError('Only HTTPS remote URLs are allowed')
}

const defaultResolveHost: ResolveHost = async (hostname) => {
  const normalizedHostname = normalizeHostname(hostname)
  const ipVersion = net.isIP(normalizedHostname)
  if (ipVersion === 4 || ipVersion === 6) {
    return [{ address: normalizedHostname, family: ipVersion }]
  }

  const addresses = await lookup(normalizedHostname, {
    all: true,
    verbatim: true
  })
  return addresses.map(({ address, family }) => ({
    address,
    family: family as 4 | 6
  }))
}

const resolveSafeAddresses = async ({
  resolveHost,
  url
}: {
  resolveHost: ResolveHost
  url: URL
}) => {
  const addresses = await resolveHost(url.hostname)
  if (addresses.length === 0) {
    throw createUnsafeUrlError('Unable to resolve remote host')
  }

  const allowDevelopmentLocalhost = allowsDevelopmentLocalhost(url)
  const unsafeAddress = addresses.find(({ address }) =>
    allowDevelopmentLocalhost
      ? !isLoopbackAddress(address)
      : isUnsafeAddress(address)
  )
  if (unsafeAddress) {
    throw createUnsafeUrlError(
      `Unsafe remote address: ${unsafeAddress.address}`
    )
  }

  return addresses
}

const createFixedDnsLookup = (
  resolvedAddresses: ResolvedRemoteAddress[]
): OptionsInit['dnsLookup'] =>
  ((_hostname: string, optionsOrCallback: unknown, maybeCallback: unknown) => {
    const rawOptions =
      typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback
    const options =
      typeof rawOptions === 'number'
        ? { family: rawOptions as 0 | 4 | 6 }
        : (rawOptions as { all?: boolean; family?: 0 | 4 | 6 } | undefined)
    const callback = (
      typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : maybeCallback
    ) as
      | ((
          error: NodeJS.ErrnoException | null,
          address: string,
          family: 4 | 6
        ) => void)
      | ((
          error: NodeJS.ErrnoException | null,
          addresses: ResolvedRemoteAddress[]
        ) => void)
      | undefined

    if (!callback) return

    const requestedFamily = options?.family
    const filterByRequestedFamily = ({ family }: ResolvedRemoteAddress) =>
      requestedFamily === undefined ||
      requestedFamily === 0 ||
      family === requestedFamily

    if (options?.all) {
      ;(
        callback as (
          error: NodeJS.ErrnoException | null,
          addresses: ResolvedRemoteAddress[]
        ) => void
      )(null, resolvedAddresses.filter(filterByRequestedFamily))
      return
    }

    const resolvedAddress =
      resolvedAddresses.find(filterByRequestedFamily) ?? resolvedAddresses[0]
    if (!resolvedAddress) return
    ;(
      callback as (
        error: NodeJS.ErrnoException | null,
        address: string,
        family: 4 | 6
      ) => void
    )(null, resolvedAddress.address, resolvedAddress.family)
  }) as OptionsInit['dnsLookup']

const gotTransport: SafeRemoteFetchTransport = async ({
  body,
  connectTimeoutInMilliseconds,
  headers,
  method,
  readTimeoutInMilliseconds,
  resolvedAddresses,
  url
}) =>
  new Promise((resolve, reject) => {
    const options: OptionsInit = {
      body,
      dnsLookup: createFixedDnsLookup(resolvedAddresses),
      followRedirect: false,
      headers,
      method,
      retry: RETRY_DISABLED,
      throwHttpErrors: false,
      timeout: {
        connect: connectTimeoutInMilliseconds,
        request: connectTimeoutInMilliseconds + readTimeoutInMilliseconds,
        response: readTimeoutInMilliseconds,
        socket: readTimeoutInMilliseconds
      }
    }
    const stream = got.stream(url.toString(), options)
    const responseBody = new PassThrough()
    const rejectBeforeResponse = (error: Error) => {
      reject(error)
    }
    const forwardStreamError = (error: Error) => {
      queueMicrotask(() => {
        responseBody.destroy(error)
      })
    }

    stream.once('error', rejectBeforeResponse)
    stream.once('response', (response) => {
      stream.off('error', rejectBeforeResponse)
      stream.on('error', forwardStreamError)
      responseBody.once('close', () => {
        stream.off('error', forwardStreamError)
        if (!stream.destroyed) stream.destroy()
      })
      stream.pipe(responseBody)
      resolve({
        body: responseBody,
        headers: response.headers,
        statusCode: response.statusCode
      })
    })
  })

const compactHeaders = (headers: SafeRemoteFetchHeaders = {}) =>
  Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string | string[]] => {
        const [, value] = entry
        return typeof value !== 'undefined'
      }
    )
  )

const buildHeaders = ({
  headers,
  previousUrl,
  url
}: {
  headers: SafeRemoteFetchHeaders
  previousUrl?: URL
  url: URL
}) => {
  const normalizedHeaders = compactHeaders(headers)
  const isCrossHostRedirect = previousUrl && previousUrl.host !== url.host

  for (const key of Object.keys(normalizedHeaders)) {
    const normalizedKey = key.toLowerCase()
    if (normalizedKey === 'host') delete normalizedHeaders[key]
    if (isCrossHostRedirect && SENSITIVE_REDIRECT_HEADERS.has(normalizedKey)) {
      delete normalizedHeaders[key]
    }
  }

  return {
    ...normalizedHeaders,
    host: url.host
  }
}

const getRequestHeaders = ({
  body,
  headers,
  method,
  previousUrl,
  url
}: {
  body?: string
  headers: SafeRemoteFetchHeaderSource
  method: SafeRemoteFetchMethod
  previousUrl?: URL
  url: URL
}) => {
  if (typeof headers === 'function') {
    return buildHeaders({
      headers: headers({ body, method, url }),
      previousUrl,
      url
    })
  }

  return buildHeaders({
    headers,
    previousUrl,
    url
  })
}

const getHeaderValue = (
  headers: Record<string, string | string[] | undefined>,
  key: string
) => {
  const normalizedKey = key.toLowerCase()
  const matchingKey = Object.keys(headers).find(
    (headerKey) => headerKey.toLowerCase() === normalizedKey
  )
  const value = matchingKey ? headers[matchingKey] : undefined
  if (Array.isArray(value)) return value[0]
  return value
}

const readResponseBody = async (
  response: SafeRemoteFetchTransportResponse,
  maxBodyBytes: number
) => {
  const declaredLength = Number(
    getHeaderValue(response.headers, 'content-length')
  )
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    const error = createResponseTooLargeError()
    response.body.destroy()
    throw error
  }

  const chunks: Buffer[] = []
  let bodyBytes = 0

  for await (const chunk of response.body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bodyBytes += buffer.byteLength

    if (bodyBytes > maxBodyBytes) {
      const error = createResponseTooLargeError()
      response.body.destroy()
      throw error
    }

    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

const getRedirectLocation = (
  response: SafeRemoteFetchTransportResponse,
  currentUrl: URL
) => {
  if (!REDIRECT_STATUS_CODES.has(response.statusCode)) return null

  const location = getHeaderValue(response.headers, 'location')
  if (!location) return null

  const redirectUrl = new URL(location, currentUrl)
  redirectUrl.username = ''
  redirectUrl.password = ''
  return redirectUrl
}

const stripHeaders = (
  headers: SafeRemoteFetchHeaders,
  headersToStrip: Set<string>
) => {
  const normalizedHeaders = compactHeaders(headers)
  for (const key of Object.keys(normalizedHeaders)) {
    if (headersToStrip.has(key.toLowerCase())) {
      delete normalizedHeaders[key]
    }
  }

  return normalizedHeaders
}

const stripBodyHeaders = (headers: SafeRemoteFetchHeaders) =>
  stripHeaders(headers, BODY_REDIRECT_HEADERS)

const stripDynamicBodyHeaders = (
  headerBuilder: SafeRemoteFetchHeaderBuilder
): SafeRemoteFetchHeaderBuilder => {
  return (request) =>
    stripHeaders(headerBuilder(request), DYNAMIC_BODY_REDIRECT_HEADERS)
}

export const createSafeRemoteFetch = ({
  resolveHost = defaultResolveHost,
  transport = gotTransport
}: {
  resolveHost?: ResolveHost
  transport?: SafeRemoteFetchTransport
} = {}) => {
  const safeRemoteFetch = async ({
    body,
    connectTimeoutInMilliseconds,
    headers = {},
    maxBodyBytes = DEFAULT_SAFE_REMOTE_FETCH_MAX_BODY_BYTES,
    maxRedirects = DEFAULT_SAFE_REMOTE_FETCH_MAX_REDIRECTS,
    method = 'GET',
    readTimeoutInMilliseconds,
    timeoutInMilliseconds = 10000,
    url
  }: SafeRemoteFetchOptions): Promise<SafeRemoteFetchResult> => {
    let currentUrl = new URL(url)
    currentUrl.username = ''
    currentUrl.password = ''

    let currentBody = body
    let currentHeaders = headers
    let currentMethod = method
    let previousUrl: URL | undefined
    let redirectCount = 0
    const connectTimeout = connectTimeoutInMilliseconds ?? timeoutInMilliseconds
    const readTimeout = readTimeoutInMilliseconds ?? timeoutInMilliseconds
    const effectiveMaxRedirects = Math.min(
      Math.max(0, maxRedirects),
      DEFAULT_SAFE_REMOTE_FETCH_MAX_REDIRECTS
    )

    while (true) {
      assertAllowedProtocol(currentUrl)
      const requestHeaders = getRequestHeaders({
        body: currentBody,
        headers: currentHeaders,
        method: currentMethod,
        previousUrl,
        url: currentUrl
      })
      const resolvedAddresses = await resolveSafeAddresses({
        resolveHost,
        url: currentUrl
      })
      const firstResolvedAddress = resolvedAddresses[0]
      if (!firstResolvedAddress) {
        throw createUnsafeUrlError('Unable to resolve remote host')
      }
      const response = await transport({
        body: currentBody,
        connectTimeoutInMilliseconds: connectTimeout,
        headers: requestHeaders,
        method: currentMethod,
        readTimeoutInMilliseconds: readTimeout,
        resolvedAddress: firstResolvedAddress,
        resolvedAddresses,
        url: currentUrl
      })
      const redirectUrl = getRedirectLocation(response, currentUrl)
      if (!redirectUrl) {
        const responseBody = await readResponseBody(response, maxBodyBytes)
        return {
          body: responseBody,
          headers: response.headers,
          statusCode: response.statusCode,
          url: currentUrl.toString()
        }
      }

      response.body.destroy()
      if (redirectCount >= effectiveMaxRedirects) {
        throw new SafeRemoteFetchError(
          'Too many redirects',
          'ERR_TOO_MANY_REDIRECTS'
        )
      }

      previousUrl = currentUrl
      currentUrl = redirectUrl
      redirectCount += 1
      if (response.statusCode === 303) {
        currentBody = undefined
        currentMethod = 'GET'
      }

      if (typeof currentHeaders === 'function') {
        if (response.statusCode === 303) {
          currentHeaders = stripDynamicBodyHeaders(currentHeaders)
        }
      } else {
        currentHeaders =
          response.statusCode === 303
            ? stripBodyHeaders(requestHeaders)
            : requestHeaders
      }
    }
  }

  return safeRemoteFetch
}

export const safeRemoteFetch = createSafeRemoteFetch()
