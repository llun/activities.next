/** Object-store prefix for raw PDS blobs. Never served by the public media route. */
export const PDS_BLOB_STORAGE_PREFIX = 'pds-blobs'

/**
 * Whether a storage-root-relative file path (a directory listing or an S3 key)
 * is a raw PDS blob. Separators are normalised and the prefix compared without
 * case, as a case-insensitive filesystem would.
 *
 * These bytes are referenced by `pds_blobs.storageKey`, not by any `medias`
 * row, so a tool that decides what is orphaned from the media tables alone
 * would report every one of them as unreferenced.
 */
export const isPdsBlobStoragePath = (file: string) => {
  const normalized = file.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
  return (
    normalized === PDS_BLOB_STORAGE_PREFIX ||
    normalized.startsWith(`${PDS_BLOB_STORAGE_PREFIX}/`)
  )
}

/** Maximum length of a DID stored in PDS tables. */
export const MAX_PDS_DID_LENGTH = 255

/** Maximum CBOR-encoded size of a single ATProto record (1 MiB). */
export const MAX_PDS_RECORD_SIZE_BYTES = 1024 * 1024

/** Maximum framed CAR byte length of the `blocks` field in a `#commit` event (2,000,000 bytes). */
export const MAX_PDS_COMMIT_BYTES = 2_000_000

/** Maximum number of write operations allowed in one applyPdsWrites call. */
export const MAX_PDS_WRITES_PER_COMMIT = 200

/** Maximum size of a single PDS blob upload (50 MiB). */
export const MAX_PDS_BLOB_SIZE_BYTES = 50 * 1024 * 1024

/** Retention window for sequenced PDS events in `pds_events` (7 days). */
export const PDS_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** PostgreSQL LISTEN/NOTIFY channel signalled when a `pds_events` row is inserted. */
export const PDS_EVENTS_NOTIFY_CHANNEL = 'pds_events'

/**
 * PostgreSQL transaction-scoped advisory lock key acquired before inserting
 * into `pds_events` so concurrent transactions commit in strict `seq` order
 * (ASCII `'pdsevent'` as a positive 64-bit signed integer).
 */
export const PDS_EVENTS_APPEND_LOCK_KEY = 0x7064736576656e74n
