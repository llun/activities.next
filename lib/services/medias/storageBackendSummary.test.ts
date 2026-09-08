import { MediaStorageType } from '@/lib/config/mediaStorage'

import { describeMediaStorageBackend } from './storageBackendSummary'

describe('describeMediaStorageBackend', () => {
  it('reports that uploads are unavailable when no backend is configured', () => {
    expect(describeMediaStorageBackend(null)).toEqual({
      label: 'Not configured — media uploads are unavailable'
    })
    expect(describeMediaStorageBackend()).toEqual({
      label: 'Not configured — media uploads are unavailable'
    })
  })

  it('names the directory for filesystem storage', () => {
    expect(
      describeMediaStorageBackend({
        type: MediaStorageType.LocalFile,
        path: '/var/lib/activities/media'
      })
    ).toEqual({ label: 'Local filesystem — /var/lib/activities/media' })
  })

  it.each([
    {
      description: 's3 storage',
      type: MediaStorageType.S3Storage
    },
    {
      description: 'object storage',
      type: MediaStorageType.ObjectStorage
    }
  ])('names the bucket and region for $description', ({ type }) => {
    expect(
      describeMediaStorageBackend({
        type,
        bucket: 'media.example.social',
        region: 'eu-central-1'
      })
    ).toEqual({ label: 'S3 — media.example.social', detail: 'eu-central-1' })
  })

  it('includes a custom endpoint so R2 or MinIO is distinguishable', () => {
    expect(
      describeMediaStorageBackend({
        type: MediaStorageType.S3Storage,
        bucket: 'media',
        region: 'auto',
        endpoint: 'https://account.r2.cloudflarestorage.com'
      })
    ).toEqual({
      label: 'S3 — media',
      detail: 'auto · https://account.r2.cloudflarestorage.com'
    })
  })
})
