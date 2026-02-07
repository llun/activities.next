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

    for (const row of mediaCounts) {
        const counterId = `${COUNTER_PREFIX}${row.accountId}`
        const count = parseInteger(row.count)

        await knex('counters')
            .insert({
                id: counterId,
                value: count,
                createdAt: currentTime,
                updatedAt: currentTime
            })
            .onConflict('id')
            .merge({
                value: count,
                updatedAt: currentTime
            })
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
