export const BULK_IMPORT_TYPES = [
  'following',
  'blocking',
  'muting',
  'domain_blocking',
  'bookmarks',
  'lists'
] as const
export type BulkImportType = (typeof BULK_IMPORT_TYPES)[number]
export const BULK_IMPORT_ROWS_LIMIT = 20_000
// The lists route's title rule: trimmed, 1..255 (lists.title is varchar(255))
export const BULK_IMPORT_LIST_NAME_MAX_LENGTH = 255
export const BULK_IMPORT_FILE_SIZE_LIMIT = 5 * 1024 * 1024
// An unfinished import with no progress for this long is treated as abandoned
export const BULK_IMPORT_STALE_MS = 24 * 60 * 60 * 1000

// One parsed row, Mastodon's attribute names
export type BulkImportRowData = {
  acct?: string
  show_reblogs?: boolean | null
  notify?: boolean | null
  languages?: string[] | null
  hide_notifications?: boolean | null
  domain?: string
  uri?: string
  list_name?: string
  // Set by the overwrite pre-pass: the actor `acct` resolved to (null: it did
  // not resolve). Handles can differ from the stored actor's domain, so this
  // is what matches a row to an existing follow, block or mute.
  resolvedActorId?: string | null
}
