const COUNTER_PREFIX = 'total-media:'

exports.config = { transaction: false }

const parseInteger = (input) => {
  if (input === null || input === undefined) return 0
  const parsed = Number.parseInt(`${input}`, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  console.log('Backfilling total-media counters...')

  // Get all accounts with their media counts
  const mediaCounts = await knex('medias')
    .join('actors', 'medias.actorId', 'actors.id')
    .whereNotNull('actors.accountId')
    .select('actors.accountId')
    .count('medias.id as count')
    .groupBy('actors.accountId')

  console.log(`Found ${mediaCounts.length} accounts with media`)

  const currentTime = new Date()
  const BATCH_SIZE = 500
  for (let i = 0; i < mediaCounts.length; i += BATCH_SIZE) {
    const batch = mediaCounts.slice(i, i + BATCH_SIZE)
    const countersToUpsert = batch.map((row) => ({
      id: `${COUNTER_PREFIX}${row.accountId}`,
      value: parseInteger(row.count),
      createdAt: currentTime,
      updatedAt: currentTime
    }))

    if (countersToUpsert.length > 0) {
      await knex('counters').insert(countersToUpsert).onConflict('id').merge()
    }
  }

  console.log(`Done. Backfilled ${mediaCounts.length} total-media counters.`)
}

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  // Delete all total-media counters
  await knex('counters').where('id', 'like', `${COUNTER_PREFIX}%`).delete()
}
