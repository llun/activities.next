import {
  KnexConnection,
  chunkArray,
  getWhereInBatchSize
} from '@/lib/database/sql/utils/knex'
import { PUBLIC_ACTIVITY_RECIPIENTS } from '@/lib/database/sql/utils/statusVisibility'

export type StatusHashtagTagRow = {
  statusId: string
  name: string
}

export const selectHashtagTagsByStatusIds = async (
  database: KnexConnection,
  statusIds: string[]
) => {
  const rows: StatusHashtagTagRow[] = []
  for (const statusIdChunk of chunkArray(
    statusIds,
    getWhereInBatchSize(database, 1)
  )) {
    rows.push(
      ...(await database('tags')
        .where('type', 'hashtag')
        .whereIn('statusId', statusIdChunk)
        .select<StatusHashtagTagRow[]>('statusId', 'name'))
    )
  }
  return rows
}

// "Addressed to the public collection" (public or unlisted) — Mastodon's
// `distributable?`. Counters a logged-out visitor can read (a status's
// replies_count, a hashtag's post count) only move for these, so a
// followers-only or direct reply or hashtag is not observable as a count.
export const isPubliclyAddressed = ({
  to,
  cc
}: {
  to: string[]
  cc: string[]
}): boolean =>
  [...to, ...cc].some((recipient) =>
    PUBLIC_ACTIVITY_RECIPIENTS.includes(recipient)
  )

// The subset of `statusIds` that is publicly addressed, read from `recipients`.
// The delete paths use it to mirror `isPubliclyAddressed` at create time, so it
// MUST run before those statuses' recipient rows are removed.
export const selectPubliclyAddressedStatusIds = async (
  database: KnexConnection,
  statusIds: string[]
): Promise<Set<string>> => {
  const ids = new Set<string>()
  for (const statusIdChunk of chunkArray(
    statusIds,
    getWhereInBatchSize(database, PUBLIC_ACTIVITY_RECIPIENTS.length)
  )) {
    const rows = await database('recipients')
      .whereIn('statusId', statusIdChunk)
      .whereIn('actorId', PUBLIC_ACTIVITY_RECIPIENTS)
      .distinct<{ statusId: string }[]>('statusId')
    for (const row of rows) ids.add(row.statusId)
  }
  return ids
}
