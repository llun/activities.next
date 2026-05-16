import { S3Client } from '@aws-sdk/client-s3'

export type StorageS3ClientConfig = {
  region: string
  endpoint?: string
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
  region
}: StorageS3ClientConfig) => {
  const normalizedEndpoint = endpoint?.trim()
    ? normalizeStorageEndpoint(endpoint)
    : undefined

  return new S3Client({
    region,
    ...(normalizedEndpoint
      ? {
          endpoint: normalizedEndpoint,
          forcePathStyle: true
        }
      : null)
  })
}
