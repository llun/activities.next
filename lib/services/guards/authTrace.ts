import { trace } from '@opentelemetry/api'

const MAX_ATTRIBUTE_LENGTH = 500

const bound = (value: string): string =>
  value.length > MAX_ATTRIBUTE_LENGTH
    ? value.slice(0, MAX_ATTRIBUTE_LENGTH)
    : value

/**
 * Stamps an authentication rejection reason and optional diagnostic metadata
 * onto the active OpenTelemetry span. If tracing is disabled or no span is
 * recording, this is a no-op.
 */
export const annotateAuthRejection = (
  reason: string,
  extra: Record<string, string | number | boolean | string[] | undefined> = {}
): void => {
  try {
    const span = trace.getActiveSpan()
    if (!span || !span.isRecording()) return
    span.setAttribute('auth.reject_reason', reason)
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) continue
      span.setAttribute(
        `auth.${key}`,
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

/**
 * Stamps successful authentication metadata onto the active OpenTelemetry span.
 */
export const annotateAuthSuccess = ({
  authType,
  actorId,
  clientId,
  userId,
  grantedScopes
}: {
  authType: 'bearer' | 'session'
  actorId?: string | null
  clientId?: string | null
  userId?: string | null
  grantedScopes?: string[] | null
}): void => {
  try {
    const span = trace.getActiveSpan()
    if (!span || !span.isRecording()) return
    span.setAttribute('auth.authenticated', true)
    span.setAttribute('auth.auth_type', authType)
    if (actorId) {
      span.setAttribute('auth.actor_id', bound(actorId))
    }
    if (clientId) {
      span.setAttribute('auth.client_id', bound(clientId))
    }
    if (userId) {
      span.setAttribute('auth.user_id', bound(userId))
    }
    if (grantedScopes && grantedScopes.length > 0) {
      span.setAttribute('auth.granted_scopes', bound(grantedScopes.join(' ')))
    }
  } catch {
    // Tracing failures must never alter response handling
  }
}

/**
 * Stamps anonymous authentication context onto the active OpenTelemetry span.
 */
export const annotateAuthAnonymous = ({
  downgraded = false,
  reason
}: {
  downgraded?: boolean
  reason?: string
} = {}): void => {
  try {
    const span = trace.getActiveSpan()
    if (!span || !span.isRecording()) return
    span.setAttribute('auth.auth_type', 'anonymous')
    if (downgraded) {
      span.setAttribute('auth.downgraded_from_invalid_token', true)
    }
    if (reason) {
      span.setAttribute('auth.token_reject_reason', bound(reason))
    }
  } catch {
    // Tracing failures must never alter response handling
  }
}
