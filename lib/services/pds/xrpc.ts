import { Readable } from 'node:stream'

import { HOST_HEADER_NAMES } from '@/lib/utils/host'
import { getStrictTransportSecurityHeader } from '@/lib/utils/http-headers/hsts'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { PdsError } from './errors'

export const XRPC_CORS_ALLOW_METHODS = 'GET, POST, HEAD, OPTIONS'
export const XRPC_CORS_ALLOW_HEADERS =
  'authorization, content-type, atproto-accept-labelers, atproto-proxy, dpop'
export const XRPC_CORS_EXPOSE_HEADERS =
  'content-type, content-length, content-disposition, retry-after'

export const XRPC_CAR_CONTENT_TYPE = 'application/vnd.ipld.car'
export const XRPC_BLOB_CSP = "default-src 'none'; sandbox"

const formatVaryHeaderName = (name: string): string =>
  name
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join('-')

// Exact host headers `getPdsRequestHost` reads, so caches never cross PDS and
// non-PDS hostnames.
export const XRPC_VARY_HEADER = [...HOST_HEADER_NAMES]
  .reverse()
  .map(formatVaryHeaderName)
  .join(', ')

// Raster image types safe to render inline alongside nosniff + sandbox CSP.
// SVG and all non-image types are delivered as `application/octet-stream` with
// `Content-Disposition: attachment`.
export const SAFE_INLINE_PDS_BLOB_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
])

export const getSafePdsBlobContentHeaders = (
  mimeType: string
): { contentType: string; contentDisposition?: 'attachment' } => {
  const sanitized = mimeType.replace(/[\r\n]+/g, '').trim()
  const baseMime = sanitized.split(';')[0]?.trim().toLowerCase() ?? ''
  if (SAFE_INLINE_PDS_BLOB_MIME_TYPES.has(baseMime)) {
    return { contentType: baseMime }
  }
  return {
    contentType: 'application/octet-stream',
    contentDisposition: 'attachment'
  }
}

const baseCorsHeaders = (): Headers =>
  new Headers([
    ['Access-Control-Allow-Origin', '*'],
    ['Access-Control-Expose-Headers', XRPC_CORS_EXPOSE_HEADERS],
    ['X-Content-Type-Options', 'nosniff'],
    ['Cache-Control', 'no-store'],
    ['Vary', XRPC_VARY_HEADER]
  ])

const mergeHeaders = (target: Headers, extra?: HeadersInit): Headers => {
  if (!extra) return target
  const extraHeaders = new Headers(extra)
  extraHeaders.forEach((value, key) => {
    target.set(key, value)
  })
  return target
}

/**
 * Adds `Strict-Transport-Security` on HTTPS responses (reusing the proxy's
 * helper so plain HTTP and local hosts never receive HSTS).
 */
export const withXrpcHsts = (
  response: Response,
  request: { nextUrl: { protocol: string; hostname: string } }
): Response => {
  const hsts = getStrictTransportSecurityHeader(request)
  if (hsts && !response.headers.has(hsts.key)) {
    response.headers.set(hsts.key, hsts.value)
  }
  return response
}

/**
 * Plain 404 used when PDS is disabled or a request arrives on a non-PDS host.
 * Emits no PDS-specific CORS headers so the host reveals nothing about PDS.
 */
export const xrpcNotFoundResponse = (isHead = false): Response => {
  const body = JSON.stringify({ error: 'Not Found' })
  const headers = new Headers([
    ['Content-Type', 'application/json; charset=utf-8'],
    ['X-Content-Type-Options', 'nosniff'],
    ['Cache-Control', 'no-store'],
    ['Vary', XRPC_VARY_HEADER]
  ])
  if (isHead) {
    headers.set('Content-Length', String(Buffer.byteLength(body, 'utf8')))
    return new Response(null, { status: 404, headers })
  }
  return new Response(body, { status: 404, headers })
}

export const xrpcOptionsResponse = (
  allowMethods: string = XRPC_CORS_ALLOW_METHODS
): Response =>
  new Response(null, {
    status: 204,
    headers: new Headers([
      ['Access-Control-Allow-Origin', '*'],
      ['Access-Control-Allow-Methods', allowMethods],
      ['Access-Control-Allow-Headers', XRPC_CORS_ALLOW_HEADERS],
      ['Access-Control-Expose-Headers', XRPC_CORS_EXPOSE_HEADERS],
      ['Access-Control-Max-Age', '86400'],
      ['Cache-Control', 'no-store'],
      ['Vary', XRPC_VARY_HEADER]
    ])
  })

export const xrpcJsonResponse = (
  data: unknown,
  {
    status = 200,
    isHead = false,
    headers: extraHeaders
  }: { status?: number; isHead?: boolean; headers?: HeadersInit } = {}
): Response => {
  const body = JSON.stringify(data)
  const headers = mergeHeaders(baseCorsHeaders(), extraHeaders)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  if (isHead) {
    headers.set('Content-Length', String(Buffer.byteLength(body, 'utf8')))
    return new Response(null, { status, headers })
  }
  return new Response(body, { status, headers })
}

export const xrpcErrorResponse = ({
  error,
  message,
  status = 400,
  isHead = false,
  headers
}: {
  error: string
  message: string
  status?: number
  isHead?: boolean
  headers?: HeadersInit
}): Response =>
  xrpcJsonResponse({ error, message }, { status, isHead, headers })

export const xrpcInvalidPathResponse = (isHead = false): Response =>
  xrpcErrorResponse({
    error: 'InvalidRequest',
    message: 'Not Found',
    status: 404,
    isHead
  })

export const xrpcMethodNotImplementedResponse = (isHead = false): Response =>
  xrpcErrorResponse({
    error: 'MethodNotImplemented',
    message: 'Method Not Implemented',
    status: 501,
    isHead
  })

export const xrpcMethodNotAllowedResponse = (
  allow: string,
  isHead = false
): Response =>
  xrpcErrorResponse({
    error: 'InvalidRequest',
    message: 'Method not allowed',
    status: 405,
    isHead,
    headers: { Allow: allow }
  })

export const xrpcRateLimitExceededResponse = (
  retryAfterSeconds: number,
  isHead = false
): Response =>
  xrpcErrorResponse({
    error: 'RateLimitExceeded',
    message: 'Rate limit exceeded',
    status: 429,
    isHead,
    headers: {
      'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds)))
    }
  })

export const xrpcErrorFromThrown = (
  error: unknown,
  isHead = false
): Response => {
  if (
    error instanceof PdsError &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return xrpcErrorResponse({
      error: error.code,
      message: error.message,
      status: error.statusCode,
      isHead
    })
  }

  logger.error({
    err: toLoggableError(error),
    message: 'Unhandled PDS XRPC error'
  })
  return xrpcErrorResponse({
    error: 'InternalServerError',
    message: 'Internal Server Error',
    status: 500,
    isHead
  })
}

const closeIterableSafely = async (
  iterable: AsyncIterable<Uint8Array>
): Promise<void> => {
  if (iterable instanceof Readable) {
    if (!iterable.destroyed) iterable.destroy()
    return
  }
  const maybeIterator = iterable as Partial<AsyncIterator<Uint8Array>>
  if (typeof maybeIterator.return === 'function') {
    await maybeIterator.return().catch(() => undefined)
  }
}

const asyncIterableToWebStream = (
  iterable: AsyncIterable<Uint8Array>
): ReadableStream<Uint8Array> => {
  let iterator: AsyncIterator<Uint8Array> | null = null
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!iterator) {
          iterator = iterable[Symbol.asyncIterator]()
        }
        const { value, done } = await iterator.next()
        if (done) {
          controller.close()
        } else {
          controller.enqueue(
            value instanceof Uint8Array ? value : new Uint8Array(value)
          )
        }
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      if (iterator?.return) {
        await iterator.return().catch(() => undefined)
      } else {
        await closeIterableSafely(iterable)
      }
    }
  })
}

export const xrpcCarResponse = async (
  iterable: AsyncIterable<Uint8Array>,
  { isHead = false }: { isHead?: boolean } = {}
): Promise<Response> => {
  const headers = baseCorsHeaders()
  headers.set('Content-Type', XRPC_CAR_CONTENT_TYPE)

  if (isHead) {
    await closeIterableSafely(iterable)
    return new Response(null, { status: 200, headers })
  }

  return new Response(asyncIterableToWebStream(iterable), {
    status: 200,
    headers
  })
}

export const xrpcBlobResponse = ({
  stream,
  mimeType,
  size,
  isHead = false
}: {
  stream: Readable
  mimeType: string
  size: number
  isHead?: boolean
}): Response => {
  try {
    const { contentType, contentDisposition } =
      getSafePdsBlobContentHeaders(mimeType)
    const headers = baseCorsHeaders()
    headers.set('Content-Type', contentType)
    headers.set('Content-Length', String(size))
    headers.set('Content-Security-Policy', XRPC_BLOB_CSP)
    if (contentDisposition) {
      headers.set('Content-Disposition', contentDisposition)
    }

    if (isHead) {
      if (!stream.destroyed) {
        stream.destroy()
      }
      return new Response(null, { status: 200, headers })
    }

    const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>
    return new Response(webStream, { status: 200, headers })
  } catch (error) {
    if (!stream.destroyed) {
      stream.destroy()
    }
    throw error
  }
}
