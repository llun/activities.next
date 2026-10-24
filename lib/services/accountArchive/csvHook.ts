import type { Readable } from 'stream'

import type { Database } from '@/lib/database/types'

import type { ArchiveActorPlan } from './layout'

/**
 * One Mastodon CSV file (`following_accounts.csv`, `followers.csv`,
 * `lists.csv`, `blocked_accounts.csv`, ...) written at the archive root for the
 * default profile.
 */
export interface MastodonCsvEntry {
  /** The entry name at the archive root, for example `following_accounts.csv`. */
  name: string
  /** Opens the file's content; called once, while the archive is assembled. */
  open: (context: {
    database: Database
    accountId: string
    actor: ArchiveActorPlan
  }) => Promise<Readable | string>
}

/**
 * The hook for Mastodon's CSV files. The archive is assembled by one streaming
 * pass, which asks this function for the CSV files to add after the
 * Mastodon-shaped JSON of the default profile.
 *
 * It returns nothing yet: the CSV writers (and their import-side parsers) land
 * with the Mastodon CSV export work, which registers its entries here instead of
 * duplicating the CSV code in this module. The follows, followers, lists,
 * mutes, blocks and domain blocks are in the meantime in
 * `activities.next/.../graph.json`, so nothing is lost.
 */
export const getMastodonCsvEntries = (): MastodonCsvEntry[] => []
