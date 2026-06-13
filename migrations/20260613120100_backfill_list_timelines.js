/**
 * One-time backfill of materialized list feeds. List timelines are now read from
 * the `timelines` table (keyed `list:<listId>`, scoped by the owner's actorId)
 * instead of a live statuses⋈list_accounts join. This populates that partition
 * for every existing membership so list timelines have full history immediately.
 *
 * Idempotent: inserts ignore conflicts on the unique (actorId, timeline,
 * statusId), so re-running heals drift instead of duplicating rows. The chunk
 * size keeps each INSERT under SQLite's 999 bound-parameter limit (6 columns).
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
  const now = new Date()
  const CHUNK = 100
  for (const membership of memberships) {
    const statuses = await knex('statuses')
      .where('actorId', membership.targetActorId)
      .select('id', 'createdAt')
    if (statuses.length === 0) continue
    const rows = statuses.map((statusRow) => ({
      actorId: membership.actorId,
      timeline: `list:${membership.listId}`,
      statusId: statusRow.id,
      statusActorId: membership.targetActorId,
      createdAt: statusRow.createdAt,
      updatedAt: now
    }))
    for (let i = 0; i < rows.length; i += CHUNK) {
      await knex('timelines')
        .insert(rows.slice(i, i + CHUNK))
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
