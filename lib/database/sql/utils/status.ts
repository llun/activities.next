import {
  KnexConnection,
  chunkArray,
  getWhereInBatchSize
} from '@/lib/database/sql/utils/knex'

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
