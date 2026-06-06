import { headerHost } from '@/lib/services/guards/headerHost'

/**
 * Builds a Mastodon-style `Link` header (rel="next"/rel="prev") for the
 * account-list endpoints that paginate with opaque id cursors —
 * `reblogged_by` and `favourited_by`. Mastodon treats `max_id`/`since_id` as
 * opaque tokens, so each endpoint supplies its own `toCursor` to turn a page
 * item into the cursor string. Pages are always presented newest-first, so
 * `max_id` (the last/oldest item) advances to the next/older page and
 * `since_id` (the first/newest item) walks back to the previous/newer one.
 *
 * `hasNext`/`hasPrev` gate the two links independently: a forward (`min_id`)
 * page detects overflow on the newer side, so the caller must wire that to
 * `hasPrev` rather than `hasNext`. Returns `undefined` when there is nothing to
 * page over (empty page) or the request host cannot be resolved.
 */
export const buildAccountCursorLinkHeader = <T>({
  req,
  limit,
  items,
  hasNext,
  hasPrev,
  toCursor
}: {
  req: Request
  limit: number
  items: T[]
  hasNext: boolean
  hasPrev: boolean
  toCursor: (item: T) => string
}): string | undefined => {
  if (items.length === 0) return undefined

  const requestUrl = new URL(req.url)
  const host = headerHost(req.headers)
  if (!host) return undefined

  const buildUrl = (cursor: 'max_id' | 'since_id', value: string) => {
    const params = new URLSearchParams()
    params.set('limit', `${limit}`)
    params.set(cursor, value)

    const url = new URL(requestUrl.pathname, `https://${host}`)
    url.search = params.toString()
    return url.toString()
  }

  const firstItem = items[0]
  const lastItem = items[items.length - 1]
  const nextLink = hasNext
    ? `<${buildUrl('max_id', toCursor(lastItem))}>; rel="next"`
    : null
  const prevLink = hasPrev
    ? `<${buildUrl('since_id', toCursor(firstItem))}>; rel="prev"`
    : null
  return [nextLink, prevLink].filter(Boolean).join(', ') || undefined
}
