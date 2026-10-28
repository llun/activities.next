import { describe, expect, it } from 'vitest'

import { ARCHIVE_ERROR_LABELS, archiveErrorBody } from './exportCopy'

// Every reason the server can store in `archive.error`, from the archive job
// and service code:
// - 'The export stopped making progress' (lib/services/accountArchive/reaper.ts)
// - 'The drafts could not be stored' (lib/services/accountArchive/request.ts)
// - 'The export could not be queued' (lib/services/accountArchive/request.ts)
// - 'The export could not be completed' (lib/jobs/exportAccountArchiveJob.ts,
//   FAILURE_MESSAGE)
// - 'Storage is not configured' (lib/jobs/exportAccountArchiveJob.ts)
const DOCUMENTED_ARCHIVE_ERRORS = [
  'The export stopped making progress',
  'The drafts could not be stored',
  'The export could not be queued',
  'The export could not be completed',
  'Storage is not configured'
]

describe('exportCopy', () => {
  it('has a plain-English label for every reason the server can store', () => {
    expect(Object.keys(ARCHIVE_ERROR_LABELS).sort()).toEqual(
      [...DOCUMENTED_ARCHIVE_ERRORS].sort()
    )
    for (const label of Object.values(ARCHIVE_ERROR_LABELS)) {
      expect(label).toMatch(/^The |^Your |^This /)
      expect(label).toMatch(/\.$/)
    }
  })

  it('builds the alert body from the stored reason', () => {
    expect(archiveErrorBody('The export stopped making progress')).toBe(
      'The export stopped making progress partway through. Your last request does not count; try again.'
    )
  })

  it('falls back to a generic body for an unknown or missing reason', () => {
    const fallback =
      'Something went wrong while making it. Your last request does not count; try again.'
    expect(archiveErrorBody('A reason this build does not know')).toBe(fallback)
    expect(archiveErrorBody(null)).toBe(fallback)
    expect(archiveErrorBody(undefined)).toBe(fallback)
  })
})
