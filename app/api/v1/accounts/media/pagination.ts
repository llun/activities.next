export const DEFAULT_PAGE = 1
export const MIN_PAGE = 1
export const MAX_PAGE = 10000

export const ALLOWED_MEDIA_LIMITS = [25, 50, 100] as const
export type MediaLimit = (typeof ALLOWED_MEDIA_LIMITS)[number]
export const DEFAULT_MEDIA_LIMIT: MediaLimit = 25

export interface AccountMediaPagination {
  page: number
  limit: MediaLimit
}

/**
 * Parses pagination parameters (`page` and `limit`) for the account media route.
 *
 * - Accepts URLSearchParams, URL, Request, or string (full URL, relative path, or query string).
 * - Preserves `parseInt` prefix acceptance (e.g. `'25foo'` -> 25).
 * - Clamps `page` to 1..10,000.
 * - Defaults malformed/non-finite `page` input to 1.
 * - Restricts `limit` strictly to 25, 50, or 100; defaults any other value or malformed input to 25.
 * - Guaranteed to return finite numbers for both `page` and `limit` (never `NaN` or `Infinity`).
 */
function extractSearchParams(
  input?: URLSearchParams | URL | Request | string | null
): URLSearchParams {
  if (!input) {
    return new URLSearchParams()
  }
  if (input instanceof URLSearchParams) {
    return input
  }
  if (input instanceof URL) {
    return input.searchParams
  }
  if (typeof input === 'object') {
    if (
      'searchParams' in input &&
      input.searchParams instanceof URLSearchParams
    ) {
      return input.searchParams
    }
    if (
      'nextUrl' in input &&
      input.nextUrl &&
      typeof input.nextUrl === 'object' &&
      'searchParams' in input.nextUrl &&
      input.nextUrl.searchParams instanceof URLSearchParams
    ) {
      return input.nextUrl.searchParams
    }
    if ('url' in input && typeof input.url === 'string') {
      input = input.url
    } else {
      return new URLSearchParams()
    }
  }

  if (typeof input === 'string') {
    const withoutHash = input.split('#')[0]
    const queryIndex = withoutHash.indexOf('?')
    if (queryIndex !== -1) {
      return new URLSearchParams(withoutHash.slice(queryIndex + 1))
    }
    if (withoutHash.includes('/') || withoutHash.includes('://')) {
      return new URLSearchParams()
    }
    return new URLSearchParams(withoutHash)
  }

  return new URLSearchParams()
}

/**
 * Parses pagination parameters (`page` and `limit`) for the account media route.
 *
 * - Accepts URLSearchParams, URL, Request, or string (full URL, relative path, or query string).
 * - Preserves `parseInt` prefix acceptance (e.g. `'25foo'` -> 25).
 * - Clamps `page` to 1..10,000.
 * - Defaults malformed/non-finite `page` input to 1.
 * - Restricts `limit` strictly to 25, 50, or 100; defaults any other value or malformed input to 25.
 * - Guaranteed to return finite numbers for both `page` and `limit` (never `NaN` or `Infinity`).
 */
export function parseAccountMediaPagination(
  input?: URLSearchParams | URL | Request | string | null
): AccountMediaPagination {
  const searchParams = extractSearchParams(input)

  const pageParam = searchParams.get('page')
  const limitParam = searchParams.get('limit')

  const parsedPage = pageParam ? parseInt(pageParam, 10) : DEFAULT_PAGE
  const page = Number.isFinite(parsedPage)
    ? Math.max(MIN_PAGE, Math.min(MAX_PAGE, parsedPage))
    : DEFAULT_PAGE

  const parsedLimit = limitParam
    ? parseInt(limitParam, 10)
    : DEFAULT_MEDIA_LIMIT
  const limit: MediaLimit = (
    ALLOWED_MEDIA_LIMITS as readonly number[]
  ).includes(parsedLimit)
    ? (parsedLimit as MediaLimit)
    : DEFAULT_MEDIA_LIMIT

  return { page, limit }
}
