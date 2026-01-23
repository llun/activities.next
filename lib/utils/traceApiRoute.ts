import { SpanStatusCode } from '@opentelemetry/api'
import { NextRequest } from 'next/server'

import { getSpan } from './trace'

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

/**
 * Wraps an API route handler with OpenTelemetry tracing
 * @param name - Name of the operation (will be prefixed with 'api.')
 * @param handler - The route handler function to wrap
 * @param options - Optional configuration for the trace
 * @returns A wrapped route handler with automatic OTEL tracing
 */
export function traceApiRoute<P = unknown>(
  name: string,
  handler: RouteHandler<P>,
  options: TraceApiRouteOptions<P> = {}
): RouteHandler<P> {
  const { op = 'api', addAttributes } = options

  return async (req: NextRequest, context: { params: Promise<P> }) => {
    const span = getSpan(op, name)

    try {
      // Add custom attributes if provided
      if (addAttributes) {
        const attributes = await addAttributes(req, context)
        Object.entries(attributes).forEach(([key, value]) => {
          if (value !== undefined) {
            span.setAttribute(key, value)
          }
        })
      }

      // Execute the handler
      const response = await handler(req, context)

      // Set success status based on response status code
      const statusCode = response.status
      if (statusCode >= 200 && statusCode < 400) {
        span.setStatus({ code: SpanStatusCode.OK })
      } else {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${statusCode}`
        })
      }

      span.end()
      return response
    } catch (error) {
      // Record the exception and set error status
      const err = error instanceof Error ? error : new Error(String(error))
      span.recordException(err)
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err.message
      })
      span.end()
      throw error
    }
  }
}
