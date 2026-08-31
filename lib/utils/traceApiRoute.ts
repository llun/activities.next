import {
  SpanStatusCode,
  TraceFlags,
  context,
  propagation,
  trace
} from '@opentelemetry/api'
import { NextRequest } from 'next/server'

import { getTracer } from './trace'

type RouteHandler<P = unknown> = (
  req: NextRequest,
  context: { params: Promise<P> }
) => Promise<Response>

export interface TraceApiRouteOptions<P = unknown> {
  op?: string
  addAttributes?: (
    req: NextRequest,
    context: { params: Promise<P> }
  ) =>
    | Promise<Record<string, string | number | boolean>>
    | Record<string, string | number | boolean>
}

export const parseCloudTraceContext = (
  header: string
): {
  traceId: string
  spanId: string
  traceFlags: number
  isRemote: boolean
} | null => {
  const match = header.match(
    /^([0-9a-fA-F]{32})(?:\/([0-9]+))?(?:;o=([0-9]+))?/
  )
  if (!match) return null
  const [, traceId, spanIdDec, options] = match
  let spanId = '0000000000000000'
  if (spanIdDec) {
    try {
      spanId = BigInt(spanIdDec).toString(16).padStart(16, '0')
    } catch {
      spanId = '0000000000000000'
    }
  }
  const isSampled = options === '1'
  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    traceFlags: isSampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true
  }
}

export const extractTraceContext = (req: NextRequest) => {
  const activeCtx = context.active()
  if (!req.headers) return activeCtx

  // Extract standard W3C traceparent / tracestate / baggage
  const extractedCtx = propagation.extract(activeCtx, req.headers, {
    get(carrier, key) {
      return carrier.get(key) ?? undefined
    },
    keys(carrier) {
      const keys: string[] = []
      carrier.forEach((_, key) => keys.push(key))
      return keys
    }
  })

  // Check for Google Cloud Trace context header (X-Cloud-Trace-Context)
  const cloudTraceHeader = req.headers.get('x-cloud-trace-context')
  if (cloudTraceHeader) {
    const cloudSpanContext = parseCloudTraceContext(cloudTraceHeader)
    if (cloudSpanContext && trace.isSpanContextValid(cloudSpanContext)) {
      return trace.setSpanContext(extractedCtx, cloudSpanContext)
    }
  }

  return extractedCtx
}

export function traceApiRoute<P = unknown>(
  name: string,
  handler: RouteHandler<P>,
  options: TraceApiRouteOptions<P> = {}
): RouteHandler<P> {
  const { op = 'api', addAttributes } = options

  return (req: NextRequest, routeContext: { params: Promise<P> }) => {
    const parentContext = extractTraceContext(req)
    return context.with(parentContext, () => {
      return getTracer().startActiveSpan(`${op}.${name}`, async (span) => {
        try {
          try {
            const url = req.nextUrl ?? new URL(req.url, 'http://localhost')
            span.setAttribute('http.request.method', req.method)
            span.setAttribute('url.path', url.pathname)
            const query = url.search
              ? url.search.startsWith('?')
                ? url.search.slice(1)
                : url.search
              : ''
            if (query) {
              span.setAttribute('url.query', query)
            }
            const userAgent = req.headers?.get?.('user-agent')
            if (userAgent) {
              span.setAttribute('user_agent.original', userAgent)
            }
          } catch {
            // Tracing failures must never alter request handling
          }

          if (addAttributes) {
            try {
              const attributes = await addAttributes(req, routeContext)
              Object.entries(attributes).forEach(([key, value]) => {
                if (value !== undefined) {
                  span.setAttribute(key, value)
                }
              })
            } catch {
              // Tracing failures must never alter request handling
            }
          }

          const response = await handler(req, routeContext)

          const statusCode = response.status
          try {
            span.setAttribute('http.response.status_code', statusCode)
            span.setAttribute('http.status_code', statusCode)
          } catch {
            // Tracing failures must never alter response handling
          }
          if (statusCode >= 200 && statusCode < 400) {
            span.setStatus({ code: SpanStatusCode.OK })
          } else {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `HTTP ${statusCode}`
            })
          }

          return response
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          span.recordException(err)
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err.message
          })
          throw error
        } finally {
          span.end()
        }
      })
    })
  }
}
