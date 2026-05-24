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

// Use this for status-scoped tables that can also contain rows written by
// other actors, such as status history and poll votes. Plain statusId deletion
// is only safe for tables whose rows belong entirely to the deleted statuses.
export const deleteRowsByOwnedStatusIdChunks = async ({
  database,
  tableName,
  statusIds,
  statusActorIds
}: {
  database: KnexConnection
  tableName: string
  statusIds: string[]
  statusActorIds: string[]
}) => {
  const actorIds = [...new Set(statusActorIds)]

  for (const actorIdChunk of chunkArray(
    actorIds,
    getWhereInBatchSize(database, 1)
  )) {
    const statusIdBatchSize = getWhereInBatchSize(database, actorIdChunk.length)

    for (const statusIdChunk of chunkArray(statusIds, statusIdBatchSize)) {
      await database(tableName)
        .whereIn(
          'statusId',
          database('statuses')
            .select('id')
            .whereIn('id', statusIdChunk)
            .whereIn('actorId', actorIdChunk)
        )
        .delete()
    }
  }
}
