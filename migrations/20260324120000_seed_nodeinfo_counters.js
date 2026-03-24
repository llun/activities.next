/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const currentTime = new Date()

  // Count total local users (actors with an accountId)
  const totalUsersResult = await knex('actors')
    .whereNotNull('accountId')
    .count('* as count')
    .first()
  const totalUsers = parseInt(totalUsersResult?.count ?? '0', 10)

  // Count local posts by summing total-status counters for local actors
  const localActors = await knex('actors')
    .whereNotNull('accountId')
    .select('id')
  let localPosts = 0
  for (const actor of localActors) {
    const counter = await knex('counters')
      .where('id', `total-status:${actor.id}`)
      .first('value')
    if (counter?.value) {
      const val =
        typeof counter.value === 'number'
          ? counter.value
          : parseInt(counter.value, 10)
      if (!isNaN(val) && val > 0) {
        localPosts += val
      }
    }
  }

  // Compute active user counts
  const now = Date.now()
  const nowSeconds = Math.floor(now / 1000)
  const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)
  const sixMonthsAgo = new Date(now - 180 * 24 * 60 * 60 * 1000)

  const activeCounts = await knex('statuses')
    .join('actors', 'statuses.actorId', 'actors.id')
    .whereNotNull('actors.accountId')
    .andWhere('statuses.createdAt', '>=', sixMonthsAgo)
    .select(
      knex.raw('count(distinct case when ?? >= ? then ?? end) as ??', [
        'statuses.createdAt',
        oneMonthAgo,
        'statuses.actorId',
        'activeMonth'
      ]),
      knex.raw('count(distinct ??) as ??', [
        'statuses.actorId',
        'activeHalfyear'
      ])
    )
    .first()

  const activeMonth = parseInt(String(activeCounts?.activeMonth ?? '0'), 10)
  const activeHalfyear = parseInt(
    String(activeCounts?.activeHalfyear ?? '0'),
    10
  )

  // Upsert all nodeinfo counters (use seconds for computed-at to fit in 32-bit integer)
  const counters = [
    { id: 'nodeinfo:total-users', value: totalUsers },
    { id: 'nodeinfo:local-posts', value: localPosts },
    { id: 'nodeinfo:active-month', value: activeMonth },
    { id: 'nodeinfo:active-halfyear', value: activeHalfyear },
    { id: 'nodeinfo:computed-at', value: nowSeconds }
  ]

  for (const counter of counters) {
    await knex('counters')
      .insert({
        id: counter.id,
        value: counter.value,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict('id')
      .merge({
        value: counter.value,
        updatedAt: currentTime
      })
  }

  console.log(
    `Seeded nodeinfo counters: totalUsers=${totalUsers}, localPosts=${localPosts}, activeMonth=${activeMonth}, activeHalfyear=${activeHalfyear}`
  )
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex('counters')
    .whereIn('id', [
      'nodeinfo:total-users',
      'nodeinfo:local-posts',
      'nodeinfo:active-month',
      'nodeinfo:active-halfyear',
      'nodeinfo:computed-at'
    ])
    .delete()
}
