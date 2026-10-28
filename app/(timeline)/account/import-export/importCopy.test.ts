import { describe, expect, it } from 'vitest'

import {
  IMPORTED_KIND_LABELS,
  IMPORT_ERROR_LABELS,
  IMPORT_PHASE_LABELS,
  IMPORT_REASON_LABELS,
  importReportRows
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

// The item kinds the import catalog counts (CatalogItemKind in
// lib/services/accountImport/phases.ts).
const DOCUMENTED_KINDS = [
  'status',
  'media',
  'own-media',
  'like',
  'bookmark',
  'gallery-settings',
  'gallery-gear',
  'fitness-gear',
  'album',
  'fitness-file'
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

  it('has a plain-English label for every catalog item kind', () => {
    expect(Object.keys(IMPORTED_KIND_LABELS).sort()).toEqual(
      [...DOCUMENTED_KINDS].sort()
    )
  })

  it('labels own-media, gallery-gear and gallery-settings rows in words', () => {
    expect(
      importReportRows({
        done: { 'own-media': 912, 'gallery-gear': 2, 'gallery-settings': 1 },
        skipped: {},
        failed: {}
      })
    ).toEqual([
      '2 gallery gear items imported',
      '1 gallery setting imported',
      '912 photos and videos imported'
    ])
  })

  it('sums kinds that share one label into a single row', () => {
    // The posts' attachments and the gallery's own photos and videos are
    // different files counted under different kinds, but the reader sees
    // one number: the total.
    expect(
      importReportRows({
        done: { media: 3, 'own-media': 2 },
        skipped: {},
        failed: {}
      })
    ).toEqual(['5 photos and videos imported'])
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
