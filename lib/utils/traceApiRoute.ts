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
        if (addAttributes) {
          const attributes = await addAttributes(req, context)
          Object.entries(attributes).forEach(([key, value]) => {
            if (value !== undefined) {
              span.setAttribute(key, value)
            }
          })
        }

        const response = await handler(req, context)

        const statusCode = response.status
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
