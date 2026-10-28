// API errors use Mastodon's `{ error: 'message' }` shape (AGENTS.md -> API
// Response Guidelines). Surface that message so an admin-configured limit
// ("Text character limit of 100 exceeded") reaches the user instead of a
// generic failure — the client and the server can legitimately disagree while a
// tab holds a limit resolved before an admin changed it.
export const throwApiError = async (response: Response, fallback: string) => {
  const details = await response.json().catch(() => undefined)
  const message = typeof details?.error === 'string' ? details.error : undefined
  throw new ApiRequestError(
    message || fallback,
    response.status,
    parseRetryAfterMs(response.headers?.get('Retry-After')),
    details
  )
}

/** `Retry-After` as milliseconds: integer seconds or an HTTP date; else undefined. */
export const parseRetryAfterMs = (
  value: string | null | undefined
): number | undefined => {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  // `Date.parse` accepts bare numbers like "-5" as years; an HTTP date has letters.
  const date = /[a-z]/i.test(trimmed) ? Date.parse(trimmed) : Number.NaN
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

export class ApiRequestError extends Error {
  status: number
  /** From a `Retry-After` header, when the server sent a usable one. */
  retryAfterMs?: number
  /** Parsed response body for callers that need structured error details. */
  details?: Record<string, unknown>

  constructor(
    message: string,
    status: number,
    retryAfterMs?: number,
    details?: unknown
  ) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.retryAfterMs = retryAfterMs
    this.details =
      details && typeof details === 'object' && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : undefined
  }
}

// 503 (saved, delivery pending) and 409 (still being processed) on a create
// mean the server holds the post: media must be kept and a retry replays the
// same Idempotency-Key.
export const isPostKeptByServer = (error: unknown): error is ApiRequestError =>
  error instanceof ApiRequestError &&
  (error.status === 503 || error.status === 409)

// Shown beside a locked draft, after the saved-post message.
export const DRAFT_LOCKED_NOTICE = 'Editing is locked until it is sent.'

export const SESSION_EXPIRED_NOTICE =
  'Your session has expired. Sign in again, then press Post to retry.'

export const isSessionExpiredError = (error: unknown): boolean =>
  error instanceof ApiRequestError &&
  (error.status === 401 || error.status === 403)

export type FailedPostAction = 'lock' | 'unlock' | 'none'

// How a composer reacts to a failed create. A kept post (503/409) locks the
// draft under its key. On a locked retry only 410 (the kept post was deleted)
// proves nothing is kept, so only 410 unlocks the draft and drops the key.
// Every other failure keeps both: the route answers 400 for an unexpected
// error and 422 for a validation failure while the post may still be kept,
// and a new key would duplicate it. 401/403 ask the user to sign in again.
// A locked failure keeps the raw reason as its own sentence and names the way
// out (`wayOut`: "discard the draft" in PostBox, "cancel the reply" in the
// reply box).
export const classifyFailedPost = (
  error: unknown,
  {
    retryingLocked,
    fallbackMessage,
    wayOut,
    kept = isPostKeptByServer(error)
  }: {
    retryingLocked: boolean
    fallbackMessage: string
    wayOut: string
    kept?: boolean
  }
): { action: FailedPostAction; message: string } => {
  const message = describePostError(error, fallbackMessage, kept)
  if (kept) return { action: 'lock', message }
  if (!retryingLocked) return { action: 'none', message }
  if (isSessionExpiredError(error)) {
    return { action: 'lock', message: SESSION_EXPIRED_NOTICE }
  }
  if (error instanceof ApiRequestError && error.status === 410) {
    return { action: 'unlock', message }
  }
  const reason = message.replace(/[.\s]+$/, '')
  return {
    action: 'lock',
    message: `Couldn't send your saved post (${reason}). Press Post to retry or ${wayOut}.`
  }
}

// `kept` is false on the edit path, where nothing was saved.
export const describePostError = (
  error: unknown,
  fallbackMessage: string,
  kept = isPostKeptByServer(error)
): string => {
  if (kept && isPostKeptByServer(error)) {
    return error.status === 503
      ? "Your post was saved but couldn't be sent yet. Press Post again to retry."
      : 'Your post is still being sent. Please wait a moment.'
  }
  return error instanceof Error && error.message
    ? error.message
    : fallbackMessage
}

export const parseApiError = async (
  response: Response,
  fallbackMessage: string
): Promise<string> => {
  const errorText = await response.text().catch(() => response.statusText)

  if (!errorText) {
    return response.statusText || fallbackMessage
  }

  try {
    const parsedError = JSON.parse(errorText) as {
      status?: string
      message?: string
      error?: string
    }
    return (
      parsedError.status ||
      parsedError.message ||
      parsedError.error ||
      errorText
    )
  } catch {
    // Use raw text if error body is not JSON.
    return errorText
  }
}
