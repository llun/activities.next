import { S3Client } from '@aws-sdk/client-s3'

export type StorageS3ClientConfig = {
  region: string
  endpoint?: string
  /**
   * Fails a request that gets no answer for this long. Unset: the SDK default.
   * When set the client also makes a single attempt, so the call as a whole is
   * bounded by this time (the SDK would retry a timeout twice, tripling it);
   * the caller's own retry is the retry.
   */
  requestTimeoutMs?: number
}

export const normalizeStorageEndpoint = (endpoint: string) => {
  const trimmedEndpoint = endpoint.trim()
  const url = new URL(
    trimmedEndpoint.includes('://')
      ? trimmedEndpoint
      : `https://${trimmedEndpoint}`
  )
  const normalizedPathname = url.pathname.replace(/\/+$/, '')

  return `${url.protocol}//${url.host}${normalizedPathname}`
}

export const createStorageS3Client = ({
  endpoint,
  region,
  requestTimeoutMs
}: StorageS3ClientConfig) => {
  const normalizedEndpoint = endpoint?.trim()
    ? normalizeStorageEndpoint(endpoint)
    : undefined

  return new S3Client({
    region,
    ...(requestTimeoutMs ? { maxAttempts: 1 } : null),
    ...(requestTimeoutMs
      ? {
          requestHandler: {
            requestTimeout: requestTimeoutMs,
            // Without this the handler only logs a warning when a request
            // stalls; with it the request rejects with a TimeoutError.
            throwOnRequestTimeout: true,
            connectionTimeout: requestTimeoutMs
          }
        }
      : null),
    ...(normalizedEndpoint
      ? {
          endpoint: normalizedEndpoint,
          forcePathStyle: true
        }
      : null)
  })
}
