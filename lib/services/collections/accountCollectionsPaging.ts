import { z } from 'zod'

import { clampedLimit, clampedOffset } from '@/lib/utils/clampedLimit'

// The two account-scoped collection listings — `/accounts/:id/collections` and
// `/accounts/:id/in_collections` — share ONE offset-paging contract so they can
// never drift apart. `limit` clamps into [1, 80] (default 40) and `offset` into
// [0, ∞) (default 0); Mastodon clamps out-of-range values rather than erroring,
// and so do the app's other listing routes (see `clampedLimit`/`clampedOffset`).
export const ACCOUNT_COLLECTIONS_MAX_LIMIT = 80
export const ACCOUNT_COLLECTIONS_DEFAULT_LIMIT = 40

const AccountCollectionsPaging = z.object({
  limit: clampedLimit(
    ACCOUNT_COLLECTIONS_MAX_LIMIT,
    ACCOUNT_COLLECTIONS_DEFAULT_LIMIT
  ),
  offset: clampedOffset()
})

export const parseAccountCollectionsPaging = (
  url: URL
): { limit: number; offset: number } => {
  const parsed = AccountCollectionsPaging.safeParse(
    Object.fromEntries(url.searchParams)
  )
  // `clampedLimit`/`clampedOffset` never reject (they `.catch`/`.default`), so
  // this branch is unreachable; fall back to the defaults defensively.
  if (!parsed.success) {
    return { limit: ACCOUNT_COLLECTIONS_DEFAULT_LIMIT, offset: 0 }
  }
  return parsed.data
}
