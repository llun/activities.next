const errorName = (error: unknown) => (error as { name?: string }).name

// The retryable S3 error codes of the AWS SDK (smithy service-error
// classification), copied here because that package is only a transitive
// dependency.
const TRANSIENT_ERROR_NAMES = new Set([
  // Clock skew and expired credentials: a later attempt gets past them.
  'AuthFailure',
  'InvalidSignatureException',
  'RequestExpired',
  'RequestInTheFuture',
  'RequestTimeTooSkewed',
  'SignatureDoesNotMatch',
  'ExpiredToken',
  'ExpiredTokenException',
  // Throttling.
  'BandwidthLimitExceeded',
  'EC2ThrottledException',
  'LimitExceededException',
  'PriorRequestNotComplete',
  'ProvisionedThroughputExceededException',
  'RequestLimitExceeded',
  'RequestThrottled',
  'RequestThrottledException',
  'SlowDown',
  'ThrottledException',
  'Throttling',
  'ThrottlingException',
  'TooManyRequestsException',
  'TransactionInProgressException',
  // Transient server and network errors.
  'TimeoutError',
  'RequestTimeout',
  'RequestTimeoutException',
  'InternalError',
  'ServiceUnavailable'
])

/**
 * An error that a later attempt can get past: a server error, throttling, clock
 * skew, a timeout, or a network failure with no answer at all. The clients of
 * an export make a single attempt, so these must not be mistaken for a file
 * that cannot be read: the error is rethrown, the slice fails and the queue
 * retries it. A final answer (access denied, bad request) stays a skipped file.
 */
export const isTransientStorageError = (error: unknown) => {
  if (TRANSIENT_ERROR_NAMES.has(errorName(error) ?? '')) return true
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata?.httpStatusCode
  if (status === undefined) return true
  return status >= 500 || status === 429 || status === 408
}
