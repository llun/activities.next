/** Object-store prefix of every export file and staged part. Never public. */
export const ARCHIVE_STORAGE_PREFIX = 'archives'

/** An export is deleted this long after it became ready. */
export const ARCHIVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The shortest time between two export requests of one account. Mastodon's code
 * allows one every 6 days and its documentation says 7; this is the documented
 * value.
 */
export const ARCHIVE_REQUEST_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

/** How many past exports the list endpoint returns. */
export const ARCHIVE_LIST_LIMIT = 5

/** Wall-clock budget of one job slice before it saves its cursor and requeues. */
export const ARCHIVE_SLICE_BUDGET_MS = 4 * 60 * 1000

/** Rows read per page by the collectors. */
export const ARCHIVE_PAGE_SIZE = 200

/** A slice that throws this many times in a row marks the export failed. */
export const ARCHIVE_MAX_SLICE_FAILURES = 3

/** The largest drafts payload a request may carry (the browser's IndexedDB drafts). */
export const ARCHIVE_DRAFTS_MAX_BYTES = 5 * 1024 * 1024

/** Warnings kept in the cursor and the manifest. */
export const ARCHIVE_MAX_WARNINGS = 100

export const ARCHIVE_FORMAT = 'activities.next-archive'
export const ARCHIVE_FORMAT_VERSION = 1

/** Directory of everything this server adds beside the Mastodon-shaped files. */
export const ARCHIVE_EXTRAS_DIR = 'activities.next'

/** The file name a download is offered under. */
export const getArchiveDownloadFileName = (archiveId: string) =>
  `activities-archive-${archiveId.slice(0, 8)}.zip`
