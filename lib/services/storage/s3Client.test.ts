import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { PRESIGNED_UPLOAD_SIGNED_HEADERS } from '@/lib/services/storage/presignedUpload'
import {
  createStorageS3Client,
  normalizeStorageEndpoint
} from '@/lib/services/storage/s3Client'

describe('normalizeStorageEndpoint', () => {
  it('normalizes plain local endpoints without requiring a protocol', () => {
    expect(normalizeStorageEndpoint('localhost:9000')).toBe(
      'https://localhost:9000'
    )
    expect(normalizeStorageEndpoint('127.0.0.1')).toBe('https://127.0.0.1')
  })

  it('preserves custom endpoint path segments', () => {
    expect(normalizeStorageEndpoint('https://storage.example.com/s3/')).toBe(
      'https://storage.example.com/s3'
    )
    expect(normalizeStorageEndpoint('storage.example.com/s3')).toBe(
      'https://storage.example.com/s3'
    )
  })
})

describe('createStorageS3Client presigned uploads', () => {
  beforeEach(() => {
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIDEXAMPLE')
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // A checksum signed before the body exists is the empty body's, and S3
  // rejects the real upload against it.
  it('signs no request checksum into an archive upload URL', async () => {
    const url = new URL(
      await getSignedUrl(
        createStorageS3Client({ region: 'eu-central-1' }),
        new PutObjectCommand({
          Bucket: 'bucket',
          Key: 'fitness/2026-11-20/0123456789abcdef.zip',
          ContentType: 'application/zip',
          ContentLength: 2048
        }),
        { expiresIn: 3600, signableHeaders: PRESIGNED_UPLOAD_SIGNED_HEADERS }
      )
    )

    expect(
      [...url.searchParams.keys()].filter((key) =>
        key.toLowerCase().startsWith('x-amz-checksum-')
      )
    ).toEqual([])
    expect(url.searchParams.has('x-amz-sdk-checksum-algorithm')).toBe(false)
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host'
    )
  })
})
