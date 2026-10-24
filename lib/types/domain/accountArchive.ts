export const ACCOUNT_ARCHIVE_STATUSES = [
  'queued',
  'running',
  'ready',
  'failed',
  'expired'
] as const
export type AccountArchiveStatus = (typeof ACCOUNT_ARCHIVE_STATUSES)[number]

/** What the account owner chose when requesting the export. */
export interface AccountArchiveOptions {
  /** Drop media place latitude/longitude from `medias.jsonl`. */
  stripExactLocations: boolean
  /** The request carried browser drafts, staged as `activities.next/drafts.json`. */
  drafts: boolean
}

/** One row of `account_archives`. Timestamps are epoch milliseconds. */
export interface AccountArchive {
  id: string
  accountId: string
  status: AccountArchiveStatus
  options: AccountArchiveOptions
  /**
   * Random segment of every object key of this export. Server-only: never put
   * it in a response or an email.
   */
  storageToken: string
  /** The resumable cursor (opaque JSON text owned by ExportAccountArchiveJob). */
  progress: string | null
  /** Object key of the finished zip, under `archives/`. */
  storagePath: string | null
  bytes: number | null
  error: string | null
  createdAt: number
  /** When the export last moved: created, cursor saved, or requeued as stuck. */
  heartbeatAt: number
  /** How often the stuck-export reaper requeued it. */
  reapCount: number
  readyAt: number | null
  expiresAt: number | null
}

/** `<id>/<token>`: the part of every object key that belongs to one export. */
export const getArchiveStorageRoot = (
  archive: Pick<AccountArchive, 'id' | 'storageToken'>
) => `${archive.id}/${archive.storageToken}`
