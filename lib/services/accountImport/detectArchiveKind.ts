import type { ZipCatalogEntry } from './zip/reader'

export type ArchiveKind = 'mastodon' | 'activities.next' | 'unrecognised'

/** Files the exporter writes at the root of its own archives. */
const OWN_ARCHIVE_MARKERS = ['actor.json', 'outbox.json']

/** The directory the exporter nests its own extras under. */
const EXTRAS_DIR = 'activities.next'

/**
 * Says what an archive's catalog holds: another server's Mastodon export
 * (`mastodon`), this server's own export (`activities.next`), or something
 * the importer does not recognise.
 *
 * The exporter writes the Mastodon-shaped files at the root and its own
 * extras under `activities.next/`, so a catalog with that folder is the
 * server's own export, whatever else it holds.
 */
export const detectArchiveKind = (catalog: ZipCatalogEntry[]): ArchiveKind => {
  const rootNames = new Set(
    catalog
      .filter((entry) => !entry.name.includes('/'))
      .map((entry) => entry.name)
  )
  const hasExtrasDir = catalog.some((entry) =>
    entry.name.startsWith(`${EXTRAS_DIR}/`)
  )
  if (hasExtrasDir) return 'activities.next'
  const mastodonShaped = OWN_ARCHIVE_MARKERS.every((marker) =>
    rootNames.has(marker)
  )
  if (mastodonShaped) return 'mastodon'
  return 'unrecognised'
}
