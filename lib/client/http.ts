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
  throw new Error(message || fallback)
}

export class ApiRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
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
