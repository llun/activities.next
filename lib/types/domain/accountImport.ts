export const ACCOUNT_IMPORT_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
  'cancelled'
] as const
export type AccountImportStatus = (typeof ACCOUNT_IMPORT_STATUSES)[number]
export const ACCOUNT_IMPORT_KINDS = ['mastodon', 'activities.next'] as const
export type AccountImportKind = (typeof ACCOUNT_IMPORT_KINDS)[number]

/**
 * One row of `account_imports`. Timestamps are epoch milliseconds. `kind`
 * stays null until the uploaded archive has been inspected; `progress` is
 * the resumable cursor the job persists between slices, `options` the raw
 * JSON text the request carried.
 */
export interface AccountImport {
  id: string
  accountId: string
  actorId: string
  status: AccountImportStatus
  kind: string | null
  options: string
  storageToken: string
  uploadedBytes: number
  progress: string | null
  phase: string | null
  cursor: string | null
  runToken: string | null
  claimedUntil: number | null
  lastErrorCode: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  updatedAt: number
}

/**
 * One source item tracked inside an import. `kind` is the item's kind
 * (status, media, ...); `reason` and `targetId` are filled in as the
 * importer processes it.
 */
export interface AccountImportItem {
  id: string
  importId: string
  actorId: string
  kind: string
  sourceId: string
  position: number
  data: string | null
  state: 'pending' | 'done' | 'skipped' | 'failed'
  reason: string | null
  targetId: string | null
  createdAt: number
  updatedAt: number
}
