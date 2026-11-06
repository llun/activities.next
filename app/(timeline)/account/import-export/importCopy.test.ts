import { describe, expect, it } from 'vitest'

import { parseImportProgress } from '@/lib/services/accountImport/progress'

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
  // Bookmark folder entries (progress.bookmarkFolderSkips, not item rows).
  'bookmark_folder_too_large',
  'bookmark_folder_invalid',
  'bookmark_folder_name_invalid',
  'bookmark_folder_limit',
  'bookmark_folder_conflict',
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

  it('reports the bookmark folders the import skipped', () => {
    expect(
      importReportRows({ done: {}, skipped: {}, failed: {} }, [], {
        bookmark_folder_too_large: 1,
        bookmark_folder_limit: 2
      })
    ).toEqual([
      '2 bookmark folders skipped: the account already has the maximum number of bookmark folders',
      '1 bookmark folder entry skipped: the folder entry was too large to read'
    ])
  })

  it('reports a split folder skipped for a name, the cap or a conflict as 1 folder', () => {
    // Each of these reasons is counted once per folder, however many entries
    // the export split the folder into.
    expect(
      importReportRows({ done: {}, skipped: {}, failed: {} }, [], {
        bookmark_folder_name_invalid: 1,
        bookmark_folder_limit: 1,
        bookmark_folder_conflict: 1
      })
    ).toEqual([
      '1 bookmark folder skipped: the folder was changed or deleted while the import ran',
      '1 bookmark folder skipped: the account already has the maximum number of bookmark folders',
      '1 bookmark folder skipped: the folder name is not allowed'
    ])
  })

  it('reports two different skipped folders as 2 folders', () => {
    expect(
      importReportRows({ done: {}, skipped: {}, failed: {} }, [], {
        bookmark_folder_limit: 2
      })
    ).toEqual([
      '2 bookmark folders skipped: the account already has the maximum number of bookmark folders'
    ])
  })

  it('reports an unreadable entry as an entry, not a folder', () => {
    // The phase cannot know the name of an entry it could not read, so it
    // counts entries: a split folder contributes one per unreadable entry.
    expect(
      importReportRows({ done: {}, skipped: {}, failed: {} }, [], {
        bookmark_folder_too_large: 2,
        bookmark_folder_invalid: 1
      })
    ).toEqual([
      '1 bookmark folder entry skipped: the folder entry could not be read',
      '2 bookmark folder entries skipped: the folder entry was too large to read'
    ])
  })

  it('renders the stored folder skips of an import from before the wording change', () => {
    // A progress record written before this change has only the same shape:
    // one count per reason. It still renders, and the reasons whose names were
    // never known read as entries.
    const stored = JSON.stringify({
      version: 1,
      sourceActorId: null,
      sourceFollowersUrl: null,
      statusOrder: 'newest-first',
      catalogStage: 'done',
      catalogIndex: 0,
      totalItems: 0,
      completedItems: 0,
      skippedItems: 0,
      continuationCount: 0,
      bookmarkFolderSkips: {
        bookmark_folder_too_large: 1,
        bookmark_folder_limit: 1
      }
    })
    const progress = parseImportProgress(stored)

    expect(
      importReportRows(
        { done: {}, skipped: {}, failed: {} },
        [],
        progress.bookmarkFolderSkips
      )
    ).toEqual([
      '1 bookmark folder skipped: the account already has the maximum number of bookmark folders',
      '1 bookmark folder entry skipped: the folder entry was too large to read'
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
