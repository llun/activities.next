export interface BackoffOptions {
  jitter?: boolean
  maxDelaySeconds?: number
}

const DEFAULT_MAX_DELAY_SECONDS = 86400 // 24 hours

/**
 * Calculates retry delay using Mastodon's polynomial backoff:
 * delay = (attempt^4) + 15 + jitter
 * where jitter is uniformly distributed in [0, 0.5 * (attempt^4)]
 */
export const calculatePolynomialBackoffSeconds = (
  attempt: number,
  options: BackoffOptions = {}
): number => {
  const { jitter = true, maxDelaySeconds = DEFAULT_MAX_DELAY_SECONDS } = options
  const safeAttempt = Math.max(0, Math.floor(attempt))
  const basePolynomial = Math.pow(safeAttempt, 4)
  const baseDelay = basePolynomial + 15

  const jitterAmount = jitter
    ? Math.floor(Math.random() * (0.5 * basePolynomial))
    : 0
  const totalDelay = baseDelay + jitterAmount

  return Math.min(totalDelay, maxDelaySeconds)
}
