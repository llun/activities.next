import { trace } from '@opentelemetry/api'

// sqlcommenter (https://google.github.io/sqlcommenter/spec/) trailing comment
// for the active span, which the application's connection appends to every
// statement it sends (lib/database/connection.ts). Cloud SQL Insights, which
// is why this exists, parses the trace tag out of a TRAILING comment only. The
// suffix is e.g. ` /* traceparent='00-<trace>-<span>-01' */`, or null when
// there is no valid active span. The leading space is part of the suffix so
// callers can append it to compiled SQL as-is. Never throws: tracing
// failures must not alter query execution.
export const getTraceparentCommentSuffix = (): string | null => {
  try {
    const span = trace.getActiveSpan()
    if (!span) return null
    const spanContext = span.spanContext()
    if (!trace.isSpanContextValid(spanContext)) return null

    const traceFlags = spanContext.traceFlags.toString(16).padStart(2, '0')
    const traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${traceFlags}`
    return ` /* traceparent='${traceparent}' */`
  } catch {
    return null
  }
}
