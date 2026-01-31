import { Knex } from 'knex'

export const createTemporaryStatus = async (
  database: Knex,
  params: {
    statusId: string
    status: unknown
    ttl: number
  }
) => {
  const { statusId, status, ttl } = params
  const now = Date.now()
  const expiresAt = now + ttl * 1000

  await database('temporary_statuses')
    .insert({
      id: statusId,
      data: status,
      created_at: now,
      expires_at: expiresAt
    })
    .onConflict('id')
    .merge()
}

export const getTemporaryStatus = async (database: Knex, statusId: string) => {
  const result = await database('temporary_statuses')
    .where({ id: statusId })
    .first()

  if (!result) return null
  if (result.expires_at < Date.now()) {
    // Optionally auto-delete on read, but for now just return null
    // Clean up should handle the deletion
    return null
  }
  return result.data
}

export const deleteTemporaryStatus = async (
  database: Knex,
  statusId: string
) => {
  await database('temporary_statuses').where({ id: statusId }).delete()
}

export const deleteExpiredTemporaryStatuses = async (database: Knex) => {
  await database('temporary_statuses')
    .where('expires_at', '<', Date.now())
    .delete()
}
