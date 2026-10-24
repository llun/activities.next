import { S3Client } from '@aws-sdk/client-s3'

export type StorageS3ClientConfig = {
  region: string
  endpoint?: string
  /** Fails a request that gets no answer for this long. Unset: the SDK default. */
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
    ...(requestTimeoutMs
      ? {
          requestHandler: {
            requestTimeout: requestTimeoutMs,
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
