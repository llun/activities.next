import { SpanStatusCode, trace } from '@opentelemetry/api'
import { type Instrumentation } from 'next'

export const register = async () => {
  // Only run registration in Node.js runtime
  if (typeof (globalThis as any).EdgeRuntime !== 'undefined') {
    return
  }

  // Dynamically import Node.js-specific code
  const { registerNodeInstrumentation } = await import('./instrumentation.node')
  await registerNodeInstrumentation()
}

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  _request,
  _context
) => {
  const span = trace.getActiveSpan()
  if (span) {
    if (err instanceof Error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err.message
      })
      span.recordException(err)
    } else {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(err)
      })
      span.recordException(String(err))
    }
  }
}
