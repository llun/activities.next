import { trace } from '@opentelemetry/api'

const MAX_ATTRIBUTE_LENGTH = 500

const bound = (value: string): string =>
  value.length > MAX_ATTRIBUTE_LENGTH
    ? value.slice(0, MAX_ATTRIBUTE_LENGTH)
    : value

/**
 * Stamps the rejection reason for an ActivityPub inbox request onto the
 * request's existing traceApiRoute span (api.sharedInbox /
 * api.actorInbox). Never creates a span; a missing or non-recording
 * active span makes this a no-op, matching the repo-wide "tracing off is
 * free" rule in lib/utils/trace.ts.
 */
export const annotateInboxRejection = (
  reason: string,
  extra: Record<string, string | number | boolean | string[] | undefined> = {}
): void => {
  try {
    const span = trace.getActiveSpan()
    if (!span || !span.isRecording()) return
    span.setAttribute('inbox.reject_reason', reason)
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) continue
      span.setAttribute(
        `inbox.${key}`,
        typeof value === 'string'
          ? bound(value)
          : Array.isArray(value)
            ? value.map((item) => bound(item))
            : value
      )
    }
  } catch {
    // Tracing failures must never alter response handling
  }
}
