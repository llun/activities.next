import { Span, SpanStatusCode, trace } from '@opentelemetry/api'

import { VERSION } from '@/lib/utils/version'

export const TRACE_APPLICATION_SCOPE = 'activities.next'
export const TRACE_APPLICATION_VERSION = VERSION

export interface Data {
  [key: string]: string | boolean | number | undefined
}

export const getTracer = () =>
  trace.getTracer(TRACE_APPLICATION_SCOPE, TRACE_APPLICATION_VERSION)

/**
 * Runs `fn` inside an active span named `${op}.${name}`.
 * The span is the active context while `fn` runs (so nested work links to it),
 * records exceptions and ERROR status on throw, and always ends — on success,
 * on early return, and on throw. Without a registered provider this is a no-op.
 */
export const withSpan = <T>(
  op: string,
  name: string,
  data: Data = {},
  fn: (span: Span) => Promise<T>
): Promise<T> =>
  getTracer().startActiveSpan(
    `${op}.${name}`,
    { attributes: data },
    async (span) => {
      try {
        return await fn(span)
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error))
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
        throw error
      } finally {
        span.end()
      }
    }
  )
