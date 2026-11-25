// Parameter and result types of the rate-limit domain: the shared fixed-window
// counters kept in better-auth's `rateLimit` table.

// Every row the app's own limits write starts with this prefix. It keeps them
// out of better-auth's `ip|path` keys, and the auth adapter's prune for the
// `rateLimit` model skips these rows so better-auth's unfiltered expiry delete
// cannot take them.
export const APP_RATE_LIMIT_KEY_PREFIX = 'app:'

export interface ConsumeRateLimitParams {
  // The row key. Callers prefix their own namespace (`app:<bucket>:<digest>`)
  // so they never collide with better-auth's `ip|path` rows.
  key: string
  // The namespace `key` belongs to, used to bound the opportunistic cleanup to
  // the caller's own rows (better-auth's rows must never be deleted here).
  keyPrefix: string
  // How many hits the window admits.
  limit: number
  // The fixed window length in milliseconds.
  windowMs: number
  // Injectable clock so tests can exercise window resets deterministically.
  now?: number
}

export interface CheckRateLimitParams {
  // The row key, as `consumeRateLimit` takes it.
  key: string
  // How many hits the window admits.
  limit: number
  // Injectable clock so tests can exercise window resets deterministically.
  now?: number
}

export interface RateLimitConsumeResult {
  allowed: boolean
  // Seconds until the current window ends; 0 when allowed.
  retryAfterSeconds: number
}

export interface DeleteRateLimitsParams {
  // Only rows whose key starts with this prefix are considered.
  keyPrefix: string
  // Only rows whose window ended before this epoch-millisecond value.
  before?: number
  // Bound the batch to this many rows (the opportunistic cleanup uses it).
  limit?: number
}

export interface RateLimitDatabase {
  /**
   * Counts one hit for `key` in a fixed window and reports whether it is
   * allowed. The check and the increment are one atomic statement, so
   * concurrent callers on any number of server instances share the count.
   */
  consumeRateLimit(
    params: ConsumeRateLimitParams
  ): Promise<RateLimitConsumeResult>
  /**
   * Reports whether one more hit for `key` would be allowed, without counting
   * it. A caller that has its own budget to spend first can peek at a shared
   * counter and only spend its budget when the shared hit would happen.
   */
  checkRateLimit(params: CheckRateLimitParams): Promise<RateLimitConsumeResult>
  /**
   * Deletes rows under `keyPrefix`, optionally only those whose window ended
   * before `before` and at most `limit` of them. Returns the number deleted.
   */
  deleteRateLimits(params: DeleteRateLimitsParams): Promise<number>
}
