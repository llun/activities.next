import {
  EXPORT_FILES,
  exportAccountData
} from '@/lib/services/exports/accountExports'

import { entryPath } from './layout'
import type { CollectorStep } from './steps.types'

interface CsvCursor {
  index: number
}

/**
 * Mastodon's CSV files (`following_accounts.csv`, `lists.csv`,
 * `muted_accounts.csv`, `blocked_accounts.csv`, `blocked_domains.csv`,
 * `bookmarks.csv`) from the same writers as the CSV export of the web app
 * (`lib/services/exports/`), so the two cannot drift apart. They sit beside the
 * profile's `actor.json`: at the archive root for the default profile and in the
 * profile's own folder for the others.
 *
 * One file per call. Each is staged like every other document, so the zip
 * copies the staged bytes and a resumed export never builds a file twice.
 */
export const csvStep: CollectorStep = {
  name: 'csv',
  async run(context, raw) {
    const { database, actor, stage } = context
    const cursor = (raw ?? { index: 0 }) as CsvCursor
    const file = EXPORT_FILES[cursor.index]
    if (!file) return 'done'

    const content = await exportAccountData(file, database, actor.id, {
      pageSize: context.pageSize
    })
    await stage.append(entryPath(actor.mastodonDir, file), content)

    return cursor.index + 1 >= EXPORT_FILES.length
      ? 'done'
      : { cursor: { index: cursor.index + 1 } satisfies CsvCursor }
  }
}
