import { EXPORT_FILES, exportPage } from '@/lib/services/exports/accountExports'

import { entryPath } from './layout'
import type { CollectorStep } from './steps.types'

/** The file being written and where its next page starts (null: the first). */
interface CsvCursor {
  index: number
  page: unknown | null
}

/**
 * Mastodon's CSV files (`following_accounts.csv`, `lists.csv`,
 * `muted_accounts.csv`, `blocked_accounts.csv`, `blocked_domains.csv`,
 * `bookmarks.csv`) from the same writers as the CSV export of the web app
 * (`lib/services/exports/`), so the two cannot drift apart. They sit beside the
 * profile's `actor.json`: at the archive root for the default profile and in the
 * profile's own folder for the others.
 *
 * One database page of one file per call, with the page cursor in the step's
 * cursor, so a file with a very long list never has to fit one job slice. Each
 * page is staged as a part of the file's entry like every other document, so
 * the zip copies the staged bytes and a resumed export never builds a page
 * twice. The first page of a file is staged even when it is empty, so the
 * entry exists.
 */
export const csvStep: CollectorStep = {
  name: 'csv',
  async run(context, raw) {
    const { database, actor, stage } = context
    const cursor = (raw ?? { index: 0, page: null }) as CsvCursor
    const file = EXPORT_FILES[cursor.index]
    if (!file) return 'done'

    const page = await exportPage(
      file,
      database,
      actor.id,
      cursor.page,
      context.pageSize
    )
    if (cursor.page === null || page.text.length > 0) {
      await stage.append(entryPath(actor.mastodonDir, file), page.text)
    }

    if (page.next !== null) {
      return {
        cursor: { index: cursor.index, page: page.next } satisfies CsvCursor
      }
    }
    return cursor.index + 1 >= EXPORT_FILES.length
      ? 'done'
      : { cursor: { index: cursor.index + 1, page: null } satisfies CsvCursor }
  }
}
