/** The worker leaves ten seconds of the QStash deadline for cleanup and publish. */
export const ACCOUNT_IMPORT_SLICE_BUDGET_MS = 20_000
export const ACCOUNT_IMPORT_LEASE_GRACE_MS = 30_000
export const ACCOUNT_IMPORT_STUCK_AFTER_MS = 60 * 60 * 1000
export const ACCOUNT_IMPORT_MAX_STUCK_MS = 24 * 60 * 60 * 1000
export const ACCOUNT_IMPORT_LIST_LIMIT = 20
export const ACCOUNT_IMPORT_START_WINDOW_MS = 24 * 60 * 60 * 1000
export const ACCOUNT_IMPORT_MAX_STARTS = 3
export const ACCOUNT_IMPORT_PRESIGNED_URL_TTL_SECONDS = 15 * 60
export const ACCOUNT_IMPORT_CATALOG_PAGE_SIZE = 100
export const ACCOUNT_IMPORT_ITEM_PAGE_SIZE = 25

/** Positions leave space for 40 media attachments per source status. */
export const ACCOUNT_IMPORT_MAX_ITEMS = 200_000
export const ACCOUNT_IMPORT_MAX_ATTACHMENTS_PER_STATUS = 40
export const ACCOUNT_IMPORT_MEDIA_POSITION = 400_001
export const ACCOUNT_IMPORT_LIKE_POSITION = 8_500_001
export const ACCOUNT_IMPORT_BOOKMARK_POSITION = 8_700_001
