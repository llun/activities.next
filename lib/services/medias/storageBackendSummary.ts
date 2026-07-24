import { MediaStorageConfig, MediaStorageType } from '@/lib/config/mediaStorage'

// A one-line description of the configured media storage backend, for the
// read-only "Storage backend" field on the admin Posts & media page. The
// backend is environment-only, so the admin UI reports it rather than editing
// it; deriving the summary on the server keeps the storage config (paths,
// endpoints) out of the client bundle.
export interface MediaStorageBackendSummary {
  // Primary description, e.g. `S3 — media.example.social`.
  label: string
  // Secondary detail rendered muted, e.g. the S3 region.
  detail?: string
}

export const describeMediaStorageBackend = (
  storage?: MediaStorageConfig | null
): MediaStorageBackendSummary => {
  if (!storage) {
    return { label: 'Not configured — media uploads are unavailable' }
  }

  if (storage.type === MediaStorageType.LocalFile) {
    return { label: `Local filesystem — ${storage.path}` }
  }

  return {
    label: `S3 — ${storage.bucket}`,
    // A custom endpoint is what distinguishes R2/MinIO/Spaces from AWS, so it
    // belongs in the summary alongside the region.
    detail: storage.endpoint
      ? `${storage.region} · ${storage.endpoint}`
      : storage.region
  }
}
