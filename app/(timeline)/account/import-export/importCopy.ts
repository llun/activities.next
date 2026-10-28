import type { AccountImportOutcomeReport } from '@/lib/types/domain/accountImport'

export const IMPORT_PHASE_LABELS: Record<string, string> = {
  inspect: 'Reading the archive',
  catalog: 'Listing what is inside',
  profile: 'Restoring your profile',
  gears: 'Restoring gear',
  media: 'Importing photos and videos',
  statuses: 'Importing posts',
  albums: 'Restoring albums',
  collections: 'Finishing up',
  finish: 'Finishing up'
}

export const IMPORT_ERROR_LABELS: Record<string, string> = {
  archive_changed: 'The archive changed after it was uploaded.',
  upload_expired: 'The archive was not started within 24 hours.',
  upload_empty: 'The archive upload was empty.',
  file_too_large: 'The archive was too large.',
  upload_failed: 'The archive could not be stored.',
  upload_url_failed: 'An upload link could not be created.',
  queue_failed: 'The import could not be queued.',
  archive_not_a_zip: 'This file is not a ZIP archive.',
  archive_unsafe_name: 'The archive contains an unsafe file path.',
  archive_entry_too_large: 'A file inside the archive is too large.',
  archive_ratio_too_high: 'The archive is compressed too heavily.',
  archive_total_too_large: 'The expanded archive is too large.',
  archive_too_many_entries: 'The archive contains too many files.',
  import_failed: 'The import stopped because of an error.',
  item_failed: 'An item could not be imported.',
  actor_unavailable: 'This profile is no longer available.',
  import_stuck: 'The import stopped after making no progress.'
}

export const IMPORT_REASON_LABELS: Record<string, string> = {
  unknown: 'an unknown reason',
  option_disabled: 'the option was turned off',
  'reply-to-other': "replies to other people's posts were not imported",
  'reply-uri-too-long': 'the original post link was too long to keep',
  boost: 'boosts are not imported',
  direct: 'direct messages are not imported',
  invalid: 'the item could not be read',
  'bad-date': 'the post date could not be read',
  'foreign-author': 'the item belongs to another account',
  parent_unavailable: 'the original post could not be imported',
  local_status_missing: 'the liked post was not available on this server',
  bookmark_unavailable: 'the post could not be fetched from its server',
  archive_item_invalid: 'the archived item could not be read',
  media_missing: 'the photo or video was not in the archive',
  media_type_unsupported: 'this file type is not supported',
  media_too_large: 'the photo or video was too large',
  fitness_too_large: 'the fitness file was too large',
  media_invalid: 'the photo or video could not be read',
  media_quota_exceeded: 'the storage limit was reached',
  gear_invalid: 'the gear entry could not be read',
  album_invalid: 'the album could not be read',
  album_limit: 'the account already has the maximum number of albums',
  fitness_invalid: 'the fitness file could not be read',
  fitness_missing: 'the fitness file was not in the archive',
  status_unavailable: 'its post could not be imported',
  storage_unavailable: 'file storage is not available',
  item_failed: 'this item could not be imported'
}

export const importPhaseLabel = (phase: string | null): string =>
  phase ? (IMPORT_PHASE_LABELS[phase] ?? 'Finishing up') : 'Waiting to start…'

export const importErrorLabel = (code: string | null): string =>
  (code && IMPORT_ERROR_LABELS[code]) ||
  'The import stopped for an unknown reason.'

export const importReasonLabel = (code: string): string =>
  IMPORT_REASON_LABELS[code] ?? 'an unrecognized reason'

export const IMPORTED_KIND_LABELS: Record<
  string,
  { singular: string; plural: string }
> = {
  status: { singular: 'post', plural: 'posts' },
  like: { singular: 'like', plural: 'likes' },
  bookmark: { singular: 'bookmark', plural: 'bookmarks' },
  media: { singular: 'photo or video', plural: 'photos and videos' },
  'own-media': { singular: 'photo or video', plural: 'photos and videos' },
  'gallery-gear': {
    singular: 'gallery gear item',
    plural: 'gallery gear items'
  },
  'gallery-settings': {
    singular: 'gallery setting',
    plural: 'gallery settings'
  },
  'fitness-file': { singular: 'fitness file', plural: 'fitness files' },
  'fitness-gear': { singular: 'gear item', plural: 'gear items' },
  album: { singular: 'album', plural: 'albums' }
}

const countLabel = (count: number) => count.toLocaleString('en-US')

const importedRow = (kind: string, count: number) => {
  const label = IMPORTED_KIND_LABELS[kind] ?? {
    singular: kind.replaceAll(/[-_]/g, ' '),
    plural: `${kind.replaceAll(/[-_]/g, ' ')}s`
  }
  return `${countLabel(count)} ${count === 1 ? label.singular : label.plural} imported`
}

const outcomeRows = (
  values: Record<string, number>,
  label: 'skipped' | 'failed'
) =>
  Object.entries(values)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([reason, count]) =>
        `${countLabel(count)} ${label}: ${importReasonLabel(reason)}`
    )

export const importReportRows = (
  report: AccountImportOutcomeReport | undefined,
  profileImageSkips: string[] = []
): string[] => {
  const rows = report
    ? [
        ...Object.entries(report.done)
          .filter(([, count]) => count > 0)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([kind, count]) => importedRow(kind, count)),
        ...outcomeRows(report.skipped, 'skipped'),
        ...outcomeRows(report.failed, 'failed')
      ]
    : []

  const imageCounts = new Map<string, number>()
  for (const reason of profileImageSkips) {
    imageCounts.set(reason, (imageCounts.get(reason) ?? 0) + 1)
  }
  for (const [reason, count] of imageCounts) {
    const image = count === 1 ? 'profile image' : 'profile images'
    const imageReason =
      reason === 'media_invalid'
        ? 'the image could not be read'
        : importReasonLabel(reason)
    rows.push(`${countLabel(count)} ${image} skipped: ${imageReason}`)
  }
  return rows
}
