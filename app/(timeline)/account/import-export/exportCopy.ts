/**
 * The copy for a failed archive export's alert body.
 *
 * The server stores the failure reason in `archive.error` and serves it back
 * with the row, so the body must say what actually went wrong — the mockup's
 * "Something went wrong while packing your photos." is one example cause, not
 * the copy for every failure. Every reason the archive job and service code
 * can store has a plain-English sentence here; anything else (a reason this
 * build does not know, or none at all) falls back to a generic one. Both end
 * with the mockup's fixed "Your last request does not count; try again."
 */

// The reasons the server can store in `archive.error`:
// - 'The export stopped making progress' (lib/services/accountArchive/reaper.ts)
// - 'The drafts could not be stored' (lib/services/accountArchive/request.ts)
// - 'The export could not be queued' (lib/services/accountArchive/request.ts)
// - 'The export could not be completed' (lib/jobs/exportAccountArchiveJob.ts,
//   FAILURE_MESSAGE)
// - 'Storage is not configured' (lib/jobs/exportAccountArchiveJob.ts)
export const ARCHIVE_ERROR_LABELS: Record<string, string> = {
  'The export stopped making progress':
    'The export stopped making progress partway through.',
  'The drafts could not be stored':
    'Your drafts could not be stored with the request.',
  'The export could not be queued':
    'The export could not be queued on the server.',
  'The export could not be completed': 'The export could not be completed.',
  'Storage is not configured': 'This server has no storage set up for archives.'
}

const FALLBACK = 'Something went wrong while making it.'
const SUFFIX = 'Your last request does not count; try again.'

export const archiveErrorBody = (error: string | null | undefined) =>
  `${ARCHIVE_ERROR_LABELS[error ?? ''] ?? FALLBACK} ${SUFFIX}`
