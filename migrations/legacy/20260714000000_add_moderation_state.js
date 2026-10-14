/**
 * Moderation state model (Admin moderation API, Epic 4.2a).
 *
 * State lives as nullable timestamp columns on the owning rows, matching the
 * established `actors.deletionStatus`/`accounts.verifiedAt` convention, so the
 * guards and timeline filters that already load those rows can consult the
 * moderation state with no extra query. Timestamps (not booleans) so "since
 * when" comes for free and `NULL` means untouched.
 *
 * - `actors.suspendedAt`/`silencedAt`/`sensitizedAt` — apply to remote actors
 *   too (remote actors are rows with a null `accountId`), so they live on
 *   `actors`, not `accounts`.
 * - `accounts.disabledAt`/`approvedAt` — login concepts with no remote
 *   analogue. Existing accounts are approved by definition, so `approvedAt` is
 *   backfilled from `createdAt`.
 * - `reports.assignedActorId`/`actionTakenAt`/`actionTakenByActorId` — report
 *   workflow columns (actor-URL id form, consistent with `actorId`/
 *   `targetActorId`). `action_taken` already existed as the resolution flag.
 * - `moderation_actions` — append-only audit log; state columns alone cannot
 *   answer "who did this, when, against which report" once a state is cleared.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.schema.alterTable('actors', (table) => {
    // Match `actors.createdAt` (timestamp with time zone on PostgreSQL) so
    // comparisons and ordering behave identically across backends.
    table.timestamp('suspendedAt', { useTz: true }).nullable()
    table.timestamp('silencedAt', { useTz: true }).nullable()
    table.timestamp('sensitizedAt', { useTz: true }).nullable()
  })

  await knex.schema.alterTable('accounts', (table) => {
    table.timestamp('disabledAt', { useTz: true }).nullable()
    table.timestamp('approvedAt', { useTz: true }).nullable()
  })

  // Every existing account is approved by definition — there is no
  // approval-required registration mode yet (Decision 4). Backfill so the
  // session-create hook and `pending` filters treat them as approved.
  await knex('accounts').update({ approvedAt: knex.ref('createdAt') })

  await knex.schema.alterTable('reports', (table) => {
    table.string('assignedActorId', 255).nullable()
    table.timestamp('actionTakenAt', { useTz: true }).nullable()
    table.string('actionTakenByActorId', 255).nullable()
  })

  await knex.schema.createTable('moderation_actions', (table) => {
    table.string('id', 255).primary()
    table.string('targetActorId', 255).notNullable()
    table.string('moderatorAccountId', 255).notNullable()
    table.string('moderatorActorId', 255).nullable()
    // none|disable|enable|sensitive|unsensitive|silence|unsilence|suspend|
    // unsuspend|approve|reject|destroy
    table.string('action', 32).notNullable()
    table.string('reportId', 255).nullable()
    table.text('text').notNullable().defaultTo('')
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['targetActorId', 'createdAt'], 'moderation_actions_target_idx')
    table.index(['reportId'], 'moderation_actions_report_idx')
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  await knex.schema.dropTable('moderation_actions')

  await knex.schema.alterTable('reports', (table) => {
    table.dropColumn('assignedActorId')
    table.dropColumn('actionTakenAt')
    table.dropColumn('actionTakenByActorId')
  })

  await knex.schema.alterTable('accounts', (table) => {
    table.dropColumn('disabledAt')
    table.dropColumn('approvedAt')
  })

  await knex.schema.alterTable('actors', (table) => {
    table.dropColumn('suspendedAt')
    table.dropColumn('silencedAt')
    table.dropColumn('sensitizedAt')
  })
}
