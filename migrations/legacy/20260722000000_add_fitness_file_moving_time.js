export const up = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    // Time (seconds) the athlete was actually moving, excluding stopped periods.
    // Kept separate from `totalDurationSeconds` (elapsed time) so average
    // pace/speed can be computed over moving time — matching how Strava reports
    // it — while the displayed duration stays the full elapsed span. Nullable:
    // files parsed before this column existed, and files with no per-point data
    // to derive it, fall back to elapsed time. `float` to match the sibling
    // `totalDurationSeconds`/`totalDistanceMeters` columns and preserve
    // sub-second precision (integer would round on PostgreSQL).
    table.float('movingTimeSeconds')
  })
}

export const down = async function (knex) {
  await knex.schema.alterTable('fitness_files', function (table) {
    table.dropColumn('movingTimeSeconds')
  })
}
