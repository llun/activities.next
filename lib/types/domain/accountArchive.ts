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
  /** The resumable cursor (opaque JSON text owned by ExportAccountArchiveJob). */
  progress: string | null
  /** Object key of the finished zip, under `archives/`. */
  storagePath: string | null
  bytes: number | null
  error: string | null
  createdAt: number
  readyAt: number | null
  expiresAt: number | null
}
