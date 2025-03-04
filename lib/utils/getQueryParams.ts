import { NextRequest } from 'next/server'

/**
 * Gets URL query parameters from a request
 *
 * @param req NextRequest object
 * @returns Query parameters as Record<string, string>
 */
export function getQueryParams(req: NextRequest): Record<string, string> {
  const url = new URL(req.url)
  return Object.fromEntries(url.searchParams.entries())
}
