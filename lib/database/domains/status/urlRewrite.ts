import { type SqlBool, sql } from 'kysely'

import { escapeLikePattern } from '@/lib/database/domains/search/rows'
import type {
  GetStatusesForUrlRewriteParams,
  RewriteStatusUrlParams,
  StatusUrlRewriteRow
} from '@/lib/database/domains/status/types'
import type { Db } from '@/lib/database/kysely'

// The URL-rewrite plumbing behind RenameStatusUrlsJob: a keyset page of the
// actor's statuses whose url starts with a given prefix, and the rewrite of
// one row's url and urlHash. Both touch nothing else — no hydration, no
// status_history row, no updatedAt bump — because a handle rename must not
// read as a status edit.

export const getStatusesForUrlRewrite = async (
  db: Db,
  { actorId, urlPrefix, after, limit }: GetStatusesForUrlRewriteParams
): Promise<StatusUrlRewriteRow[]> => {
  const pattern = `${escapeLikePattern(urlPrefix)}%`
  return (
    db
      .selectFrom('statuses')
      .select(['id', 'url'])
      .where('actorId', '=', actorId)
      .where(sqlRefUrlLike(pattern))
      // Announces carry a null url; they embed no handle and are skipped.
      .where('url', 'is not', null)
      .$if(Boolean(after), (qb) => qb.where('id', '>', after as string))
      .orderBy('id', 'asc')
      .limit(limit)
      .execute()
      // The `url is not null` filter above guarantees the column, but Kysely's
      // select type does not narrow it.
      .then((rows) =>
        rows.map((row) => ({ id: row.id, url: row.url as string }))
      )
  )
}

// The same `like ... escape '\\'` form every other escaped prefix match in
// the repo uses, so a username holding a LIKE wildcard only ever matches
// itself.
const sqlRefUrlLike = (pattern: string) =>
  sql<SqlBool>`${sql.ref('statuses.url')} like ${pattern} escape '\\'`

export const rewriteStatusUrl = async (
  db: Db,
  { statusId, url, urlHash }: RewriteStatusUrlParams
): Promise<void> => {
  await db
    .updateTable('statuses')
    .set({ url, urlHash })
    .where('id', '=', statusId)
    .execute()
}
