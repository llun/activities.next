// API errors use Mastodon's `{ error: 'message' }` shape (AGENTS.md -> API
// Response Guidelines). Surface that message so an admin-configured limit
// ("Text character limit of 100 exceeded") reaches the user instead of a
// generic failure — the client and the server can legitimately disagree while a
// tab holds a limit resolved before an admin changed it.
export const throwApiError = async (response: Response, fallback: string) => {
  const message = await response
    .json()
    .then((body) => (typeof body?.error === 'string' ? body.error : null))
    .catch(() => null)
  throw new ApiRequestError(message || fallback, response.status)
}

export class ApiRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
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

// A retry of a kept post that the server definitively refused (410 deleted, 422
// key reuse, 400, ...): the key can never replay, so the lock and key must go.
// 408/429 are transient, 409 means kept, and 401/403 (see
// `isSessionExpiredError`) only need a new session; network and 5xx failures
// leave the saved post's state unknown. All of those keep the lock and key,
// because a new key after signing back in would duplicate the kept post.
export const isKeyRejectedByServer = (error: unknown): boolean =>
  error instanceof ApiRequestError &&
  error.status >= 400 &&
  error.status < 500 &&
  ![401, 403, 408, 409, 429].includes(error.status)

export const SESSION_EXPIRED_NOTICE =
  'Your session has expired. Sign in again, then press Post to retry.'

export const isSessionExpiredError = (error: unknown): boolean =>
  error instanceof ApiRequestError &&
  (error.status === 401 || error.status === 403)

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
