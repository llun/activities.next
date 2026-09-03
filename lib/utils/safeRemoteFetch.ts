import got, { Headers, Method, OptionsInit } from 'got'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { PassThrough, type Readable } from 'node:stream'

import { getHeaderValue } from '@/lib/utils/getHeaderValue'
import {
  isLoopbackAddress,
  isUnsafeAddress,
  normalizeHostname
} from '@/lib/utils/unsafeAddress'

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
const DYNAMIC_BODY_REDIRECT_HEADERS = new Set(
  [...BODY_REDIRECT_HEADERS].filter((header) => header !== 'signature')
)
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
  SafeRemoteFetchHeaders | SafeRemoteFetchHeaderBuilder

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
  onBodyTooLarge?: 'fail' | 'truncate'
  readTimeoutInMilliseconds?: number
  timeoutInMilliseconds?: number
  url: string
}

export type SafeRemoteFetchResult = {
  body: string
  bodyTruncated: boolean
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
      http2: true,
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
  headersToStrip,
  method,
  previousUrl,
  url
}: {
  body?: string
  headers: SafeRemoteFetchHeaderSource
  headersToStrip?: Set<string>
  method: SafeRemoteFetchMethod
  previousUrl?: URL
  url: URL
}) => {
  let effectiveHeaders =
    typeof headers === 'function' ? headers({ body, method, url }) : headers

  if (headersToStrip && headersToStrip.size > 0) {
    effectiveHeaders = stripHeaders(effectiveHeaders, headersToStrip)
  }

  return buildHeaders({
    headers: effectiveHeaders,
    previousUrl,
    url
  })
}

const readResponseBody = async (
  response: SafeRemoteFetchTransportResponse,
  maxBodyBytes: number,
  onBodyTooLarge: 'fail' | 'truncate' = 'fail'
) => {
  const declaredLength = Number(
    getHeaderValue(response.headers, 'content-length')
  )
  if (
    onBodyTooLarge === 'fail' &&
    Number.isFinite(declaredLength) &&
    declaredLength > maxBodyBytes
  ) {
    const error = createResponseTooLargeError()
    response.body.destroy()
    throw error
  }

  const chunks: Buffer[] = []
  let bodyBytes = 0
  let bodyTruncated = false

  for await (const chunk of response.body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const newTotal = bodyBytes + buffer.byteLength

    if (newTotal > maxBodyBytes) {
      if (onBodyTooLarge === 'truncate') {
        const remaining = maxBodyBytes - bodyBytes
        if (remaining > 0) {
          chunks.push(buffer.subarray(0, remaining))
        }
        bodyTruncated = true
        response.body.destroy()
        break
      }

      const error = createResponseTooLargeError()
      response.body.destroy()
      throw error
    }

    bodyBytes = newTotal
    chunks.push(buffer)
  }

  return {
    body: Buffer.concat(chunks).toString('utf8'),
    bodyTruncated
  }
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

const stripBodyHeaders = (headers: SafeRemoteFetchHeaders) =>
  stripHeaders(headers, BODY_REDIRECT_HEADERS)

const getDynamicHeadersToStrip = ({
  shouldStripBodyHeaders,
  shouldStripSensitiveHeaders
}: {
  shouldStripBodyHeaders: boolean
  shouldStripSensitiveHeaders: boolean
}) => {
  return new Set([
    ...(shouldStripBodyHeaders ? DYNAMIC_BODY_REDIRECT_HEADERS : []),
    ...(shouldStripSensitiveHeaders ? SENSITIVE_REDIRECT_HEADERS : [])
  ])
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
    onBodyTooLarge = 'fail',
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
    let shouldStripDynamicBodyHeaders = false
    let shouldStripDynamicSensitiveHeaders = false
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
        headersToStrip:
          typeof currentHeaders === 'function'
            ? getDynamicHeadersToStrip({
                shouldStripBodyHeaders: shouldStripDynamicBodyHeaders,
                shouldStripSensitiveHeaders: shouldStripDynamicSensitiveHeaders
              })
            : undefined,
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
        const { body: responseBody, bodyTruncated } = await readResponseBody(
          response,
          maxBodyBytes,
          onBodyTooLarge
        )
        return {
          body: responseBody,
          bodyTruncated,
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

      const isCrossHostRedirect = currentUrl.host !== redirectUrl.host
      previousUrl = currentUrl
      currentUrl = redirectUrl
      redirectCount += 1
      if (response.statusCode === 303) {
        currentBody = undefined
        currentMethod = 'GET'
      }

      if (typeof currentHeaders === 'function') {
        if (response.statusCode === 303) {
          shouldStripDynamicBodyHeaders = true
        }
        if (isCrossHostRedirect) {
          shouldStripDynamicSensitiveHeaders = true
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
