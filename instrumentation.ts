import { SpanStatusCode, trace } from '@opentelemetry/api'
import { type Instrumentation } from 'next'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNodeInstrumentation } =
      await import('./instrumentation.node')
    await registerNodeInstrumentation()
  }
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
