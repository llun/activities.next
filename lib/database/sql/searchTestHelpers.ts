import { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'

export const createSearchActor = async (
  database: ReturnType<typeof getSQLDatabase>,
  {
    id,
    username,
    domain = 'remote.test',
    name,
    summary
  }: {
    id: string
    username: string
    domain?: string
    name?: string
    summary?: string
  }
) => {
  await database.createActor({
    actorId: id,
    username,
    domain,
    name,
    summary,
    inboxUrl: `${id}/inbox`,
    sharedInboxUrl: `https://${domain}/inbox`,
    followersUrl: `${id}/followers`,
    publicKey: 'public-key',
    privateKey: 'private-key',
    createdAt: 1
  })
}

export const insertRowsInChunks = async (
  knexDatabase: Knex,
  tableName: string,
  rows: Record<string, unknown>[],
  chunkSize: number
) => {
  for (let start = 0; start < rows.length; start += chunkSize) {
    await knexDatabase(tableName).insert(rows.slice(start, start + chunkSize))
  }
}
