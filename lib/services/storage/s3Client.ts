import { S3Client } from '@aws-sdk/client-s3'

export type StorageS3ClientConfig = {
  region: string
  endpoint?: string
  /**
   * Fails a request that gets no answer for this long. Unset: the SDK default.
   * When set the client also makes a single attempt, so the call as a whole is
   * bounded by this time (the SDK would retry a timeout twice, tripling it);
   * the caller must retry: the archive store's errors fail the slice, and the
   * source-file reads rethrow transient errors so the slice fails and is
   * redelivered.
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
    // Since 3.729 the SDK adds a CRC32 of the request body by default. A
    // presigned PUT has no body when it is signed, so the URL would carry the
    // empty-body checksum (`x-amz-checksum-crc32=AAAAAA==`) and S3 would reject
    // the browser's upload of the real file. Compute checksums only when an
    // operation requires one; uploads that want integrity (media) set their own.
    requestChecksumCalculation: 'WHEN_REQUIRED',
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
