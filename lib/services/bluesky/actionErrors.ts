// Error answers shared by the routes that change something on Bluesky (likes,
// reposts, replies): the same mapping the follow routes use (follow.ts).
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import {
  BlueskyHostedAccountInactiveError,
  BlueskyRequestError,
  BlueskySessionChangedError,
  BlueskySessionEndedError
} from './agent'
import { BlueskyLockTimeoutError } from './client'

/** A refusal with its own message: no link, not allowed, invalid input. */
export class BlueskyActionError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 422 = 422
  ) {
    super(message)
    this.name = 'BlueskyActionError'
  }
}

export type BlueskyActionFailure = {
  status: 404 | 409 | 422 | 502
  error: string
}

/**
 * The status and `{ error }` message a route answers for a failed Bluesky
 * change, or null for an error it should not catch. `lockPrefix` names the
 * change's own lock: a session-refresh lock timing out is not that change in
 * progress.
 */
export const blueskyActionFailure = (
  error: unknown,
  { lockPrefix, busy }: { lockPrefix: string; busy: string }
): BlueskyActionFailure | null => {
  if (error instanceof BlueskyActionError) {
    return { status: error.status, error: error.message }
  }
  if (
    error instanceof BlueskyLockTimeoutError &&
    error.lockName.startsWith(lockPrefix)
  ) {
    return { status: 409, error: busy }
  }
  if (error instanceof BlueskySessionChangedError) {
    return {
      status: 409,
      error: 'Your Bluesky account was just linked again. Try again.'
    }
  }
  if (error instanceof BlueskySessionEndedError) {
    return {
      status: 422,
      error:
        error instanceof BlueskyHostedAccountInactiveError
          ? error.message
          : 'Bluesky ended this session. Link the account again in Settings.'
    }
  }
  if (error instanceof BlueskyRequestError) {
    logger.warn({
      message: 'Bluesky refused a change',
      err: toLoggableError(error)
    })
    return {
      status: 502,
      error: 'Bluesky did not accept the change. Please try again.'
    }
  }
  return null
}
