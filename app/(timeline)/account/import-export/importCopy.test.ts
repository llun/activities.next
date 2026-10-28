import { describe, expect, it } from 'vitest'

import {
  IMPORT_ERROR_LABELS,
  IMPORT_PHASE_LABELS,
  IMPORT_REASON_LABELS
} from './importCopy'

const DOCUMENTED_ERRORS = [
  'archive_changed',
  'upload_expired',
  'upload_empty',
  'file_too_large',
  'upload_failed',
  'upload_url_failed',
  'queue_failed',
  'archive_not_a_zip',
  'archive_unsafe_name',
  'archive_entry_too_large',
  'archive_ratio_too_high',
  'archive_total_too_large',
  'archive_too_many_entries',
  'import_failed',
  'item_failed',
  'actor_unavailable',
  'import_stuck'
]

const DOCUMENTED_REASONS = [
  'unknown',
  'option_disabled',
  'reply-to-other',
  'reply-uri-too-long',
  'boost',
  'direct',
  'invalid',
  'bad-date',
  'foreign-author',
  'parent_unavailable',
  'local_status_missing',
  'bookmark_unavailable',
  'archive_item_invalid',
  'media_missing',
  'media_type_unsupported',
  'media_too_large',
  'fitness_too_large',
  'media_invalid',
  'media_quota_exceeded',
  'gear_invalid',
  'album_invalid',
  'album_limit',
  'fitness_invalid',
  'fitness_missing',
  'status_unavailable',
  'storage_unavailable',
  'item_failed'
]

describe('importCopy', () => {
  it('has a plain-English label for every documented import error code', () => {
    expect(Object.keys(IMPORT_ERROR_LABELS).sort()).toEqual(
      [...DOCUMENTED_ERRORS].sort()
    )
    for (const label of Object.values(IMPORT_ERROR_LABELS)) {
      expect(label).not.toMatch(/^[a-z0-9_-]+$/)
    }
  })

  it('has a plain-English label for every documented outcome reason', () => {
    expect(Object.keys(IMPORT_REASON_LABELS).sort()).toEqual(
      [...DOCUMENTED_REASONS].sort()
    )
    for (const label of Object.values(IMPORT_REASON_LABELS)) {
      expect(label).not.toMatch(/^[a-z0-9_-]+$/)
    }
  })

  it('includes the worker phases used by archive imports', () => {
    expect(IMPORT_PHASE_LABELS).toMatchObject({
      inspect: 'Reading the archive',
      catalog: 'Listing what is inside',
      profile: 'Restoring your profile',
      gears: 'Restoring gear',
      media: 'Importing photos and videos',
      statuses: 'Importing posts',
      albums: 'Restoring albums',
      collections: 'Finishing up',
      finish: 'Finishing up'
    })
  })
})
