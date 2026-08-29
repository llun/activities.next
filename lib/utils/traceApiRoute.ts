import { SpanStatusCode } from '@opentelemetry/api'
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

export function traceApiRoute<P = unknown>(
  name: string,
  handler: RouteHandler<P>,
  options: TraceApiRouteOptions<P> = {}
): RouteHandler<P> {
  const { op = 'api', addAttributes } = options

  return (req: NextRequest, context: { params: Promise<P> }) => {
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
            const attributes = await addAttributes(req, context)
            Object.entries(attributes).forEach(([key, value]) => {
              if (value !== undefined) {
                span.setAttribute(key, value)
              }
            })
          } catch {
            // Tracing failures must never alter request handling
          }
        }

        const response = await handler(req, context)

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
  }
}
