/**
 * One-time backfill of materialized list feeds. List timelines are now read from
 * the `timelines` table (keyed `list:<listId>`, scoped by the owner's actorId)
 * instead of a live statuses⋈list_accounts join. This populates that partition
 * for every existing membership so list timelines have full history immediately.
 *
 * Idempotent: inserts ignore conflicts on the unique (actorId, timeline,
 * statusId), so re-running heals drift instead of duplicating rows. Statuses are
 * read per distinct member in chunked IN queries (not one query per membership)
 * so an account on many lists is fetched once per chunk, and the chunk sizes keep
 * both the SELECT and INSERT under SQLite's 999 bound-parameter limit.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const memberships = await knex('list_accounts').select(
    'listId',
    'actorId',
    'targetActorId'
  )
  if (memberships.length === 0) return

  // Group the (owner, list) destinations by member so each member's statuses are
  // fetched once and fanned out to every list that contains them.
  const destinationsByMember = new Map()
  for (const membership of memberships) {
    const destinations =
      destinationsByMember.get(membership.targetActorId) ?? []
    destinations.push({
      ownerId: membership.actorId,
      listId: membership.listId
    })
    destinationsByMember.set(membership.targetActorId, destinations)
  }
  const memberIds = [...destinationsByMember.keys()]

  const now = new Date()
  const SELECT_CHUNK = 200
  const INSERT_CHUNK = 100
  for (let i = 0; i < memberIds.length; i += SELECT_CHUNK) {
    const memberChunk = memberIds.slice(i, i + SELECT_CHUNK)
    const statuses = await knex('statuses')
      .whereIn('actorId', memberChunk)
      .select('id', 'actorId', 'createdAt')
    const rows = []
    for (const statusRow of statuses) {
      for (const { ownerId, listId } of destinationsByMember.get(
        statusRow.actorId
      )) {
        rows.push({
          actorId: ownerId,
          timeline: `list:${listId}`,
          statusId: statusRow.id,
          statusActorId: statusRow.actorId,
          createdAt: statusRow.createdAt,
          updatedAt: now
        })
      }
    }
    for (let j = 0; j < rows.length; j += INSERT_CHUNK) {
      await knex('timelines')
        .insert(rows.slice(j, j + INSERT_CHUNK))
        .onConflict(['actorId', 'timeline', 'statusId'])
        .ignore()
    }
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex('timelines').where('timeline', 'like', 'list:%').delete()
}
