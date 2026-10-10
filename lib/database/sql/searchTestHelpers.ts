import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { normalizeHashtagSearchName } from '@/lib/database/domains/search/rows'
import type { Db } from '@/lib/database/kysely'
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

// Raw status and recipient rows for the query tests: nothing is indexed and no
// counter moves.
export const seedStatus = async (
  db: Db,
  {
    id,
    actorId,
    createdAt,
    type = 'Note',
    text = '',
    reply = '',
    to = [],
    cc = []
  }: {
    id: string
    actorId: string
    createdAt: number
    type?: string
    text?: string
    reply?: string
    to?: string[]
    cc?: string[]
  }
) => {
  const time = new Date(createdAt)
  await db
    .insertInto('statuses')
    .values({
      id,
      url: id,
      actorId,
      type,
      content: text,
      reply,
      createdAt: time,
      updatedAt: time
    })
    .execute()
  const recipients = [
    ...to.map((recipient) => ({ actorId: recipient, type: 'to' })),
    ...cc.map((recipient) => ({ actorId: recipient, type: 'cc' }))
  ]
  if (recipients.length > 0) {
    await db
      .insertInto('recipients')
      .values(
        recipients.map((recipient) => ({
          id: randomUUID(),
          statusId: id,
          ...recipient,
          createdAt: time,
          updatedAt: time
        }))
      )
      .execute()
  }
  return id
}

// A raw tag row. Hashtags default to the `#name` stored form; pass
// nameNormalized for legacy or odd rows.
export const seedTag = (
  db: Db,
  {
    statusId,
    name,
    type = 'hashtag',
    value = '',
    nameNormalized = type === 'hashtag'
      ? `#${normalizeHashtagSearchName(name)}`
      : null
  }: {
    statusId: string
    name: string
    type?: string
    value?: string
    nameNormalized?: string | null
  }
) =>
  db
    .insertInto('tags')
    .values({
      id: randomUUID(),
      statusId,
      type,
      name,
      value,
      nameNormalized,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    .execute()

export const readSearchDocument = (
  db: Db,
  entityType: string,
  entityId: string
) =>
  db
    .selectFrom('search_documents')
    .selectAll()
    .where('entityType', '=', entityType)
    .where('entityId', '=', entityId)
    .executeTakeFirst()
