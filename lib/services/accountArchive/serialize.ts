import type { AccountArchive } from '@/lib/types/domain/accountArchive'

/** The JSON the archive endpoints return for one export. */
export const toArchiveResponse = (archive: AccountArchive) => ({
  id: archive.id,
  status: archive.status,
  stripExactLocations: archive.options.stripExactLocations,
  includesDrafts: archive.options.drafts,
  bytes: archive.bytes,
  createdAt: new Date(archive.createdAt).toISOString(),
  readyAt: archive.readyAt ? new Date(archive.readyAt).toISOString() : null,
  expiresAt: archive.expiresAt
    ? new Date(archive.expiresAt).toISOString()
    : null,
  // The failure text is a fixed sentence; nothing from storage reaches it.
  error: archive.status === 'failed' ? archive.error : null,
  downloadUrl:
    archive.status === 'ready'
      ? `/api/v1/account/archives/${archive.id}/download`
      : null
})
